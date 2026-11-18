import { sameOrigin } from "$lib/server/auth";
import { startLinkedInAuth } from "$lib/server/linkedin-auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  return startLinkedInAuth(event);
};
