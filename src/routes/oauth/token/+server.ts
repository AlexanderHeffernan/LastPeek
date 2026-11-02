import { json, isHttpError } from "@sveltejs/kit";
import { exchangeAgentToken } from "$lib/server/agent-auth";
import { rateLimit } from "$lib/server/auth";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async ({
  request,
  url,
  getClientAddress,
}) => {
  await rateLimit(`agent-token:${getClientAddress()}`, 100, 600);
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return json({ error: "invalid_request" }, { status: 400 });
  try {
    return json(
      await exchangeAgentToken(
        new URLSearchParams((await readBody(request, 16000)).toString("utf8")),
        url.origin,
      ),
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (cause) {
    if (isHttpError(cause))
      return json({ error: cause.body.message }, { status: cause.status });
    throw cause;
  }
};
