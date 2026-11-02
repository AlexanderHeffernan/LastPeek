import { json } from "@sveltejs/kit";
import { agentScopes } from "$lib/agents";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = ({ url }) =>
  json({
    resource: `${url.origin}/mcp`,
    authorization_servers: [url.origin],
    scopes_supported: agentScopes,
    bearer_methods_supported: ["header"],
  });
