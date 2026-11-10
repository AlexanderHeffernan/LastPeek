import { randomUUID } from "node:crypto";
import { error } from "@sveltejs/kit";
import { z } from "zod";
import {
  mentionAccount,
  mentionRequest,
  mentionResult,
  type MentionResult,
} from "../x-mentions";
import { db, transaction } from "./db";
import { reserveXBudget } from "./x-budget";
import { isPro, reserveAPI } from "./plans";
import { rateLimit } from "./auth";
import { decryptXToken, refreshXAccess } from "./x-auth";
import { finishXRead, xPricingBasis, xReadRates } from "./x-usage";

export async function lookupMentions(
  userId: string,
  input: unknown,
): Promise<MentionResult> {
  const { kind, query: supplied } = mentionRequest.parse(input);
  if (!(await isPro(userId))) error(403, "Mention lookup requires Pro.");
  const query = supplied.toLowerCase();
  const account = (
    await db.query("SELECT x_id FROM x_accounts WHERE user_id=$1", [userId])
  ).rows[0];
  if (!account) error(409, "Connect X in Settings to look up mentions.");
  const cached = await db.query(
    "SELECT content FROM x_mention_cache WHERE user_id=$1 AND kind=$2 AND query=$3 AND expires_at>now()",
    [userId, kind, query],
  );
  if (cached.rowCount) {
    if (!cached.rows[0].content)
      error(
        503,
        "Mention lookup is temporarily unavailable. Keep typing or try again later.",
      );
    return mentionResult.parse(cached.rows[0].content);
  }
  await rateLimit(`x-mentions:${userId}`, 30, 900);
  await refreshXAccess(userId, account.x_id, ["users.read"]);
  const cents = kind === "search" ? 5 : 1;
  const claim = await transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 11826))",
      [`${userId}:${kind}:${query}`],
    );
    const hit = (
      await client.query(
        "SELECT content FROM x_mention_cache WHERE user_id=$1 AND kind=$2 AND query=$3 AND expires_at>now()",
        [userId, kind, query],
      )
    ).rows[0];
    if (hit) return { cached: hit.content };
    const period = await reserveAPI(client, userId, "x", cents / 100);
    const connected = (
      await client.query(
        "SELECT access_token FROM x_accounts WHERE user_id=$1 AND x_id=$2",
        [userId, account.x_id],
      )
    ).rows[0];
    if (!connected) error(409, "Reconnect X to look up mentions.");
    if (!(await reserveXBudget(client, cents)))
      error(
        429,
        "X lookup budget is used. You can still type and post mentions.",
      );
    const id = randomUUID();
    await client.query(
      `INSERT INTO api_usage(id,user_id,provider,model,reserved_cents,period_start,reserved_usd,x_unit_usd,x_pricing_basis,x_read_rates)
      VALUES($1,$2,'x',$3,$4,$5,$6,0.01,$7,$8)`,
      [
        id,
        userId,
        `mention-${kind}`,
        cents,
        period,
        cents / 100,
        xPricingBasis,
        xReadRates(),
      ],
    );
    await client.query(
      `INSERT INTO x_mention_cache(user_id,kind,query,content,expires_at) VALUES($1,$2,$3,NULL,now()+interval '1 minute')
      ON CONFLICT(user_id,kind,query) DO UPDATE SET content=NULL,expires_at=EXCLUDED.expires_at`,
      [userId, kind, query],
    );
    return { id, token: await decryptXToken(connected.access_token) };
  });
  if ("cached" in claim) {
    if (!claim.cached)
      error(503, "Mention lookup is already in progress. Try again shortly.");
    return mentionResult.parse(claim.cached);
  }
  let raw: unknown;
  let status: number | null = null;
  let result: MentionResult | null = null;
  try {
    const url = new URL(
      kind === "search"
        ? "https://api.x.com/2/users/search"
        : `https://api.x.com/2/users/by/username/${query}`,
    );
    url.searchParams.set("user.fields", "profile_image_url");
    if (kind === "search") {
      url.searchParams.set("query", query);
      url.searchParams.set("max_results", "5");
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${claim.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    raw = await response.json();
    // X can report missing resources in a 200 errors-only response as well as 404.
    const absent = z
      .object({
        data: z.undefined().optional(),
        errors: z
          .array(
            z.union([
              z.object({
                type: z.enum([
                  "https://api.twitter.com/2/problems/resource-not-found",
                  "https://api.x.com/2/problems/resource-not-found",
                ]),
                parameter: z.literal("username"),
                value: z
                  .string()
                  .refine((value) => value.toLowerCase() === query),
              }),
              // The lookup quickstart also documents this older error shape.
              z.object({
                resource_type: z.literal("user"),
                title: z.literal("Not Found Error"),
                detail: z.literal(
                  `Could not find user with username: [${query}].`,
                ),
              }),
            ]),
          )
          .length(1),
      })
      .safeParse(raw);
    if (kind === "check" && (response.ok || status === 404) && absent.success) {
      result = { accounts: [], missing: true };
    } else if (response.ok) {
      const parsed = z
        .object({
          data: z
            .union([mentionAccount, z.array(mentionAccount).max(5)])
            .optional(),
          errors: z.array(z.unknown()).optional(),
        })
        .parse(raw);
      if (parsed.errors?.length) throw new Error();
      const accounts = parsed.data
        ? Array.isArray(parsed.data)
          ? parsed.data
          : [parsed.data]
        : [];
      if (
        kind === "check" &&
        (accounts.length !== 1 || accounts[0].username.toLowerCase() !== query)
      )
        throw new Error();
      result = { accounts, missing: false };
    }
  } catch {
    /* Never log provider bodies, tokens or mention search terms. */
  }
  await finishXRead(
    claim.id,
    "User",
    // Only a validated missing-user response proves no billable user was returned.
    result?.missing ? { data: [] } : raw,
    status,
    result ? "success" : "error",
  );
  if (!result)
    error(
      503,
      "Couldn’t check X accounts. Your mentions haven’t been marked invalid.",
    );
  await db.query(
    `UPDATE x_mention_cache SET content=$4,expires_at=now()+($5::int * interval '1 minute') WHERE user_id=$1 AND kind=$2 AND query=$3`,
    [userId, kind, query, result, result.missing ? 5 : 15],
  );
  // Search selections need no second paid exact lookup.
  for (const user of result.accounts)
    await db.query(
      `INSERT INTO x_mention_cache(user_id,kind,query,content,expires_at) VALUES($1,'check',$2,$3,now()+interval '15 minutes')
    ON CONFLICT(user_id,kind,query) DO UPDATE SET content=EXCLUDED.content,expires_at=EXCLUDED.expires_at`,
      [
        userId,
        user.username.toLowerCase(),
        { accounts: [user], missing: false },
      ],
    );
  return result;
}
