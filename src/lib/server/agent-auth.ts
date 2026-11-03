import { error } from "@sveltejs/kit";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import { hash, token } from "./auth";
import { hasFeatureAccess } from "./features";
import {
  agentExpiryOptions,
  agentScopes,
  acceptedAgentScopes,
  expandAgentScopes,
  normalizeAgentScopes,
  type AgentScope,
} from "../agents";

export function agentExpiryDate(value: FormDataEntryValue | null) {
  const choice = value ?? "90";
  if (!agentExpiryOptions.some((option) => option.value === choice))
    error(400, "Choose a connection expiry.");
  return choice === "never"
    ? null
    : new Date(Date.now() + Number(choice) * 86400_000);
}

export function parseAgentScopes(value: string | null): AgentScope[] {
  const scopes = [
    ...new Set((value ?? agentScopes.join(" ")).split(/\s+/).filter(Boolean)),
  ];
  if (
    scopes.some((scope) => !acceptedAgentScopes.includes(scope as AgentScope))
  )
    error(400, "Unsupported agent permissions.");
  return scopes as AgentScope[];
}

export async function registerAgent(raw: unknown) {
  const parsed = z
    .object({
      client_name: z.string().trim().min(1).max(80),
      redirect_uris: z.array(z.string().url().max(2048)).min(1).max(10),
      token_endpoint_auth_method: z.literal("none").default("none"),
      grant_types: z
        .array(z.enum(["authorization_code", "refresh_token"]))
        .optional(),
      response_types: z.array(z.literal("code")).optional(),
    })
    .safeParse(raw);
  if (!parsed.success)
    error(
      400,
      "Send a client name and valid callback addresses. Public clients with PKCE are supported.",
    );
  for (const uri of parsed.data.redirect_uris) {
    const url = new URL(uri);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.hash ||
      url.username ||
      url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    )
      error(400, "Callbacks must use HTTPS, or HTTP on localhost.");
  }
  const id = token();
  await db.query(
    "INSERT INTO agent_clients(id,name,redirect_uris) VALUES($1,$2,$3)",
    [id, parsed.data.client_name, JSON.stringify(parsed.data.redirect_uris)],
  );
  return {
    client_id: id,
    ...parsed.data,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

export async function agentAuthorization(
  params: URLSearchParams,
  origin: string,
) {
  const clientId = params.get("client_id") ?? "";
  const client = (
    await db.query<{ id: string; name: string; redirect_uris: string[] }>(
      "SELECT id,name,redirect_uris FROM agent_clients WHERE id=$1",
      [clientId],
    )
  ).rows[0];
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client || !client.redirect_uris.includes(redirectUri))
    error(400, "This agent’s callback address is not registered.");
  if (
    params.get("response_type") !== "code" ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "")
  )
    error(400, "This agent must use an authorization code with PKCE S256.");
  const resource = params.get("resource") ?? `${origin}/mcp`;
  if (resource !== `${origin}/mcp`)
    error(400, "This authorization is for a different server.");
  if ((params.get("state")?.length ?? 0) > 2048)
    error(400, "Invalid authorization state.");
  return {
    clientId,
    name: client.name,
    redirectUri,
    callbackHost: new URL(redirectUri).host,
    challenge: params.get("code_challenge")!,
    resource,
    scopes: expandAgentScopes(parseAgentScopes(params.get("scope"))),
    state: params.get("state"),
  };
}

export async function approveAgent(
  userId: string,
  request: Awaited<ReturnType<typeof agentAuthorization>>,
  scopes: AgentScope[],
  expiresAt: Date | null,
  connectionId?: string,
) {
  if (!(await hasFeatureAccess(userId, "agents"))) error(404, "Not found.");
  if (!scopes.length || scopes.some((scope) => !request.scopes.includes(scope)))
    error(400, "Choose at least one requested permission.");
  const code = token();
  await transaction(async (client) => {
    const id = connectionId || crypto.randomUUID();
    if (connectionId) {
      // The previous image exchanges codes using connection scopes. Invalidate
      // older pending codes before expanding access, including during rollout.
      await client.query("DELETE FROM agent_codes WHERE connection_id=$1", [
        id,
      ]);
      const changed = await client.query(
        `UPDATE agent_connections SET scopes=$4,
         approved_scopes=ARRAY(SELECT DISTINCT unnest(approved_scopes || $4::text[])),requested_scopes=NULL
         WHERE id=$1 AND user_id=$2 AND client_id=$3 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at>now()) AND requested_scopes IS NOT NULL
         AND $4::text[] <@ requested_scopes
         RETURNING id`,
        [id, userId, request.clientId, scopes],
      );
      if (!changed.rowCount)
        error(
          400,
          "This permission request is no longer available. Return to Settings → Agents.",
        );
    } else
      await client.query(
        "INSERT INTO agent_connections(id,user_id,client_id,scopes,approved_scopes,expires_at) VALUES($1,$2,$3,$4,$4,$5)",
        [id, userId, request.clientId, scopes, expiresAt],
      );
    await client.query(
      "INSERT INTO agent_codes(hash,connection_id,redirect_uri,challenge,resource,scopes) VALUES($1,$2,$3,$4,$5,$6)",
      [
        hash(code),
        id,
        request.redirectUri,
        request.challenge,
        request.resource,
        scopes,
      ],
    );
  });
  return code;
}

export async function exchangeAgentToken(
  form: URLSearchParams,
  origin: string,
) {
  const clientId = form.get("client_id");
  const resource = form.get("resource") ?? `${origin}/mcp`;
  if (resource !== `${origin}/mcp`) error(400, "invalid_target");
  return transaction(async (client) => {
    let connectionId: string, scopes: AgentScope[];
    if (form.get("grant_type") === "authorization_code") {
      const row = (
        await client.query(
          `SELECT c.*,a.client_id,a.revoked_at,a.expires_at AS connection_expires,a.scopes AS current_scopes
        FROM agent_codes c JOIN agent_connections a ON a.id=c.connection_id
        JOIN feature_grants g ON g.user_id=a.user_id AND g.feature='agents'
        WHERE c.hash=$1 FOR UPDATE OF c,a`,
          [hash(form.get("code") ?? "")],
        )
      ).rows[0];
      const verifier = form.get("code_verifier") ?? "";
      if (
        !row ||
        row.client_id !== clientId ||
        row.revoked_at ||
        (row.connection_expires !== null &&
          row.connection_expires <= new Date()) ||
        row.expires_at <= new Date() ||
        row.redirect_uri !== form.get("redirect_uri") ||
        row.resource !== resource ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        createHash("sha256").update(verifier).digest("base64url") !==
          row.challenge
      )
        error(400, "invalid_grant");
      await client.query("DELETE FROM agent_codes WHERE hash=$1", [row.hash]);
      connectionId = row.connection_id;
      const currentScopes = normalizeAgentScopes(row.current_scopes);
      scopes = normalizeAgentScopes(row.scopes ?? row.current_scopes).filter(
        (scope) => currentScopes.includes(scope),
      );
    } else if (form.get("grant_type") === "refresh_token") {
      const row = (
        await client.query(
          `SELECT t.*,a.client_id,a.revoked_at,a.expires_at AS connection_expires,a.scopes AS current_scopes
        FROM agent_tokens t JOIN agent_connections a ON a.id=t.connection_id
        JOIN feature_grants g ON g.user_id=a.user_id AND g.feature='agents'
        WHERE t.hash=$1 AND t.kind='refresh' FOR UPDATE OF t,a`,
          [hash(form.get("refresh_token") ?? "")],
        )
      ).rows[0];
      if (
        !row ||
        row.client_id !== clientId ||
        row.revoked_at ||
        row.expires_at <= new Date() ||
        (row.connection_expires !== null &&
          row.connection_expires <= new Date()) ||
        row.resource !== resource
      )
        error(400, "invalid_grant");
      await client.query("DELETE FROM agent_tokens WHERE hash=$1", [row.hash]);
      connectionId = row.connection_id;
      // Keep the originally delegated ceiling so permissions can be switched back
      // on in Agents. Every resource request still intersects current permissions.
      scopes = normalizeAgentScopes(row.scopes);
      if (form.has("scope")) {
        const requested = normalizeAgentScopes(
          parseAgentScopes(form.get("scope")),
        );
        if (requested.some((scope) => !scopes.includes(scope)))
          error(400, "invalid_scope");
        scopes = requested;
      }
    } else error(400, "unsupported_grant_type");
    const access = token(),
      refresh = token();
    for (const [value, kind, lifetime] of [
      [access, "access", 3600],
      [refresh, "refresh", 30 * 86400],
    ] as const)
      await client.query(
        "INSERT INTO agent_tokens(hash,connection_id,kind,scopes,resource,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second')",
        [hash(value), connectionId, kind, scopes, resource, lifetime],
      );
    const current = (
      await client.query<{ scopes: AgentScope[] }>(
        "SELECT scopes FROM agent_connections WHERE id=$1",
        [connectionId],
      )
    ).rows[0].scopes;
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope: scopes
        .filter((scope) => normalizeAgentScopes(current).includes(scope))
        .join(" "),
    };
  });
}

export async function authenticateAgent(request: Request, origin: string) {
  const value = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  if (!value) return null;
  const row = (
    await db.query<{
      connection_id: string;
      user_id: string;
      connection_scopes: AgentScope[];
      requested_scopes: AgentScope[] | null;
      token_scopes: AgentScope[];
    }>(
      `SELECT a.id AS connection_id,a.user_id,a.requested_scopes,t.scopes AS token_scopes,
    a.scopes AS connection_scopes
    FROM agent_tokens t JOIN agent_connections a ON a.id=t.connection_id
    JOIN feature_grants g ON g.user_id=a.user_id AND g.feature='agents'
    WHERE t.hash=$1 AND t.kind='access' AND t.resource=$2 AND t.expires_at>now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND a.revoked_at IS NULL`,
      [hash(value), `${origin}/mcp`],
    )
  ).rows[0];
  if (!row) return null;
  const tokenScopes = normalizeAgentScopes(row.token_scopes);
  const connectionScopes = normalizeAgentScopes(row.connection_scopes);
  await db.query(
    "UPDATE agent_connections SET last_used_at=now() WHERE id=$1",
    [row.connection_id],
  );
  return {
    connection_id: row.connection_id,
    user_id: row.user_id,
    requested_scopes:
      row.requested_scopes && normalizeAgentScopes(row.requested_scopes),
    token_scopes: tokenScopes,
    scopes: tokenScopes.filter((scope) => connectionScopes.includes(scope)),
  };
}
