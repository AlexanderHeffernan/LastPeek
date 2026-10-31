import { finishXAuth } from "$lib/server/x-auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = finishXAuth;
