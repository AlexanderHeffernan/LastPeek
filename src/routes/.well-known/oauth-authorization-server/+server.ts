import { json } from "@sveltejs/kit";
import { agentScopes } from "$lib/agents";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = ({ url }) =>
  json({
    issuer: url.origin,
    authorization_endpoint: `${url.origin}/oauth/authorize`,
    token_endpoint: `${url.origin}/oauth/token`,
    registration_endpoint: `${url.origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: agentScopes,
  });
