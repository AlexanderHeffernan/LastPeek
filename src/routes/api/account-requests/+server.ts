import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { sameOrigin, rateLimit } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  await rateLimit(`account-request:${event.getClientAddress()}`, 5, 3600);
  const body = (await readBody(event.request, 2048)).toString("utf8");
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    error(400, "Enter your name and email.");
  }
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) error(400, "Enter your name and a valid email.");
  await db.query(
    `INSERT INTO account_requests(email,name) VALUES($1,$2)
     ON CONFLICT(email) DO NOTHING`,
    [parsed.data.email, parsed.data.name],
  );
  // The same response for existing accounts, invitations and repeated requests.
  return json({ received: true });
};
