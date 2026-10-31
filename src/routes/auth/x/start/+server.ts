import { sameOrigin } from "$lib/server/auth";
import { startXAuth } from "$lib/server/x-auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  return startXAuth(event);
};
