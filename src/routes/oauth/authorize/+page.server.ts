import { error, fail, isHttpError, redirect } from "@sveltejs/kit";
import {
  agentAuthorization,
  agentExpiryDate,
  approveAgent,
  parseAgentScopes,
} from "$lib/server/agent-auth";
import { requireUser, rateLimit, sameOrigin } from "$lib/server/auth";
import { hasFeatureAccess } from "$lib/server/features";
import { db } from "$lib/server/db";
import { expandAgentScopes, type AgentScope } from "$lib/agents";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ url, locals }) => {
  if (locals.user && !(await hasFeatureAccess(locals.user.id, "agents")))
    error(404, "Not found.");
  const authorization = await agentAuthorization(url.searchParams, url.origin);
  return {
    authorization,
    upgrades: locals.user
      ? (
          await db.query<{
            id: string;
            created_at: Date;
            requested_scopes: AgentScope[];
          }>(
            `SELECT id,created_at,requested_scopes FROM agent_connections
       WHERE user_id=$1 AND client_id=$2 AND requested_scopes IS NOT NULL
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC`,
            [locals.user.id, authorization.clientId],
          )
        ).rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at.toISOString(),
          scopes: row.requested_scopes,
        }))
      : [],
    account: locals.user
      ? {
          name: locals.user.name,
          handle: locals.user.handle,
          avatar: locals.user.avatar_id,
        }
      : null,
  };
};
export const actions: Actions = {
  default: async (event) => {
    sameOrigin(event);
    const user = requireUser(event.locals);
    await rateLimit(`agent-consent:${user.id}`, 30, 600);
    const authorization = await agentAuthorization(
      event.url.searchParams,
      event.url.origin,
    );
    const form = await event.request.formData();
    const callback = new URL(authorization.redirectUri);
    if (authorization.state !== null)
      callback.searchParams.set("state", authorization.state);
    if (form.get("intent") === "deny") {
      await db.query(
        "UPDATE agent_connections SET requested_scopes=NULL WHERE id::text=$1 AND user_id=$2 AND client_id=$3",
        [String(form.get("connection") ?? ""), user.id, authorization.clientId],
      );
      callback.searchParams.set("error", "access_denied");
    } else {
      try {
        const scopes = expandAgentScopes(
          parseAgentScopes(form.getAll("scope").join(" ")),
        );
        callback.searchParams.set(
          "code",
          await approveAgent(
            user.id,
            authorization,
            scopes,
            agentExpiryDate(form.get("expiry")),
            String(form.get("connection") ?? "") || undefined,
          ),
        );
      } catch (cause) {
        if (isHttpError(cause))
          return fail(cause.status, { message: cause.body.message });
        throw cause;
      }
    }
    redirect(303, callback.href, {
      external: [new URL(authorization.redirectUri).origin],
    });
  },
};
