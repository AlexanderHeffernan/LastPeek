import { error, fail, isHttpError, redirect } from "@sveltejs/kit";
import {
  agentAuthorization,
  agentExpiryDate,
  approveAgent,
  parseAgentScopes,
} from "$lib/server/agent-auth";
import { requireUser, rateLimit, sameOrigin } from "$lib/server/auth";
import { hasFeatureAccess } from "$lib/server/features";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ url, locals }) => {
  if (locals.user && !(await hasFeatureAccess(locals.user.id, "agents")))
    error(404, "Not found.");
  const authorization = await agentAuthorization(url.searchParams, url.origin);
  return {
    authorization,
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
    if (form.get("intent") === "deny")
      callback.searchParams.set("error", "access_denied");
    else {
      try {
        const scopes = parseAgentScopes(form.getAll("scope").join(" "));
        callback.searchParams.set(
          "code",
          await approveAgent(
            user.id,
            authorization,
            scopes,
            agentExpiryDate(form.get("expiry")),
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
