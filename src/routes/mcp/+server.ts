import { json } from "@sveltejs/kit";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateAgent } from "$lib/server/agent-auth";
import { agentServer } from "$lib/server/agent-tools";
import { rateLimit } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

const handle: RequestHandler = async ({ request, url, getClientAddress }) => {
  // Browser cookies never authorize MCP. Cross-origin browser requests are not supported.
  if (
    request.headers.has("origin") &&
    request.headers.get("origin") !== url.origin
  )
    return json({ error: "Origin not allowed" }, { status: 403 });
  await rateLimit(`mcp:${getClientAddress()}`, 300, 60);
  const auth = await authenticateAgent(request, url.origin);
  if (!auth)
    return json(
      { error: "Connect your agent to LastPeek first." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (
    auth.requested_scopes?.some((scope) => !auth.token_scopes.includes(scope))
  )
    return json(
      {
        error:
          "Approve added permissions in your agent app, or cancel the request in Settings → Agents.",
      },
      {
        status: 403,
        headers: {
          "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${auth.requested_scopes.join(" ")}", resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  const server = agentServer(request, url.origin, auth.scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    maxRequestBodySize: 1_000_000,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
};
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
