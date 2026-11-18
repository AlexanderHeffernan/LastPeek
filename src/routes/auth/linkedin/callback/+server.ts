import { finishLinkedInAuth } from "$lib/server/linkedin-auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  return finishLinkedInAuth(event);
};
