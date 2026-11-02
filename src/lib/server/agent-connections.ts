import { fail, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { agentExpiryDate, parseAgentScopes } from "$lib/server/agent-auth";
import { hasFeatureAccess } from "$lib/server/features";
import type { AgentScope } from "$lib/agents";
import type { RequestEvent } from "@sveltejs/kit";

export const agentConnections = async ({
  locals,
  url,
}: Pick<RequestEvent, "locals" | "url">) => {
  const user = requireUser(locals);
  if (!(await hasFeatureAccess(user.id, "agents"))) error(404, "Not found.");
  const rows = (
    await db.query<{
      id: string;
      name: string;
      scopes: AgentScope[];
      approved_scopes: AgentScope[];
      created_at: Date;
      expires_at: Date | null;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT a.*,c.name FROM agent_connections a JOIN agent_clients c ON c.id=a.client_id WHERE a.user_id=$1 AND a.revoked_at IS NULL ORDER BY a.created_at DESC`,
      [user.id],
    )
  ).rows;
  const editId = url.searchParams.get("edit");
  if (editId && !rows.some((row) => row.id === editId))
    error(404, "Connection not found.");
  return {
    endpoint: `${url.origin}/mcp`,
    agents: rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      approvedScopes: row.approved_scopes,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at?.toISOString() ?? null,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      expired: row.expires_at !== null && row.expires_at <= new Date(),
    })),
  };
};
export const updateAgentConnection = async (event: RequestEvent) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  if (!(await hasFeatureAccess(user.id, "agents"))) error(404, "Not found.");
  const form = await event.request.formData();
  const id = String(form.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) error(404, "Connection not found.");
  if (form.get("intent") === "disconnect") {
    const changed = await db.query(
      "UPDATE agent_connections SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, user.id],
    );
    if (!changed.rowCount) error(404, "Connection not found.");
    return { id };
  }
  const scopes = parseAgentScopes(form.getAll("scope").join(" "));
  const changeExpiry = form.has("expiry") && form.get("expiry") !== "keep";
  let expiresAt: Date | null = null;
  try {
    if (changeExpiry) expiresAt = agentExpiryDate(form.get("expiry"));
  } catch {
    return fail(400, { id, message: "Choose a connection expiry." });
  }
  const changed = await db.query(
    "UPDATE agent_connections SET scopes=$1,expires_at=CASE WHEN $4 THEN $5::timestamptz ELSE expires_at END WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND $1::text[] <@ approved_scopes RETURNING id",
    [scopes, id, user.id, changeExpiry, expiresAt],
  );
  if (!changed.rowCount)
    return fail(400, {
      id,
      message:
        "This connection changed or is no longer available. Reconnect from your agent app to approve new access.",
    });
  return { id };
};
