import { sameOrigin } from "$lib/server/auth";
import {
  requireLinkedInAccess,
  startLinkedInAuth,
} from "$lib/server/linkedin-auth";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  await requireLinkedInAccess(event);
  return startLinkedInAuth(event);
};
