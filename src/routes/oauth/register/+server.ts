import { json, error } from "@sveltejs/kit";
import { registerAgent } from "$lib/server/agent-auth";
import { rateLimit } from "$lib/server/auth";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  await rateLimit(`agent-register:${getClientAddress()}`, 20, 3600);
  const body = await readBody(request, 16000);
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    error(400, "Send valid registration JSON.");
  }
  return json(await registerAgent(raw), { status: 201 });
};
