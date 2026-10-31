import { createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./db";

// Standard PPU, checked 2026-10-31. Never change historical snapshots.
// https://console.x.com/api/credits/pricing (PostCreate/User/Post)
// X staff: one PostCreate per media object, not per chunk/status call:
// https://devcommunity.x.com/t/undocumented-postcreate-usage-for-media-uploads-please-clarify-pay-per-use-billing/274646/2
// https://devcommunity.x.com/t/content-create-vs-post-create-pay-per-use/274497/2
// The docs' sliders.js maps all upload stages to an older ContentCreate tariff;
// that calculator conflicts with the staff clarification and is not used here.
export const xPricingBasis = "x-ppu-2026-10-31";
export const xWriteRate = (operation: string, hasURL = false) =>
  operation === "post-create"
    ? hasURL
      ? 0.2
      : 0.015
    : operation === "media-initialize"
      ? 0.015
      : 0;

export function xReadRates(date = new Date()) {
  return {
    Post: 0.005,
    User: 0.01,
    Media: 0.005,
    Poll: 0.005,
    Place: 0.005,
    expansions: date >= new Date("2026-11-22T00:00:00Z"),
  };
}

const resource = z.object({ id: z.string().regex(/^[0-9]{1,30}$/) });
const readResponse = z.object({
  data: z.union([resource, z.array(resource).max(100)]),
  includes: z
    .object({
      users: z.array(resource).optional(),
      media: z
        .array(z.object({ media_key: z.string().min(1).max(100) }))
        .optional(),
      polls: z.array(resource).optional(),
      places: z.array(z.object({ id: z.string().min(1).max(100) })).optional(),
      tweets: z.array(resource).optional(),
    })
    .optional(),
});

export async function finishXRead(
  id: string,
  kind: "Post" | "User",
  raw: unknown,
  status: number | null,
  outcome: "success" | "error" | "unusable",
) {
  await transaction(async (client) => {
    const event = (
      await client.query(
        "SELECT created_at,outcome,x_unit_usd,x_read_rates FROM api_usage WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!event || event.outcome !== "pending") return;
    const parsed = readResponse.safeParse(raw);
    let cost: number | null = null;
    if (status !== null && status >= 400 && status < 500 && status !== 408)
      cost = 0;
    if (status !== null && status >= 200 && status < 300 && parsed.success) {
      const { data, includes } = parsed.data;
      const rates = event.x_read_rates as ReturnType<typeof xReadRates>;
      const resources: [string, string, number][] = (
        Array.isArray(data) ? data : [data]
      ).map((item) => [kind, item.id, Number(event.x_unit_usd)]);
      if (rates.expansions) {
        for (const user of includes?.users ?? [])
          resources.push(["User", user.id, rates.User]);
        for (const media of includes?.media ?? [])
          resources.push(["Media", media.media_key, rates.Media]);
        for (const poll of includes?.polls ?? [])
          resources.push(["Poll", poll.id, rates.Poll]);
        for (const place of includes?.places ?? [])
          resources.push(["Place", place.id, rates.Place]);
        for (const post of includes?.tweets ?? [])
          resources.push(["Post", post.id, rates.Post]);
      }
      cost = 0;
      // Stable lock order prevents concurrent overlapping expansions deadlocking.
      for (const [type, resourceId, usd] of resources.sort((a, b) =>
        `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`),
      )) {
        const hash = createHash("sha256")
          .update(`${type}:${resourceId}`)
          .digest("hex");
        const charged = await client.query(
          `INSERT INTO x_read_charges(day,resource_hash,usage_id,usd)
           VALUES(($1::timestamptz AT TIME ZONE 'UTC')::date,$2,$3,$4)
           ON CONFLICT DO NOTHING RETURNING usd`,
          [event.created_at, hash, id, usd],
        );
        if (charged.rowCount) cost += usd;
      }
    }
    await client.query(
      `UPDATE api_usage SET outcome=$2,http_status=$3,estimated_usd=$4,
       completed_at=now() WHERE id=$1`,
      [id, outcome, status, cost],
    );
  });
}

// Balance is an app/payer control, never a source of invented per-user charges.
// Top-ups, changing/expiring grants, concurrent calls or unexplained differences
// require review instead of spreading a wallet delta across users.
export async function syncXCredits() {
  const key = process.env.X_API_BEARER_TOKEN?.trim();
  if (!key) return;
  const latest = (
    await db.query("SELECT * FROM x_credit_snapshots ORDER BY id DESC LIMIT 1")
  ).rows[0];
  if (latest && Date.now() - latest.observed_at.getTime() < 300000) return;
  const ledger = async () =>
    (
      await db.query(
        `SELECT COALESCE(sum(estimated_usd),0)::text AS usd,count(*)::text AS requests,
     count(*) FILTER(WHERE estimated_usd IS NULL)::text AS unresolved,
     max(completed_at)::text AS completed FROM api_usage WHERE provider='x'`,
      )
    ).rows[0];
  const before = await ledger();
  const response = await fetch("https://api.x.com/2/usage/credits", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("X credit balance unavailable");
  const { data } = z
    .object({
      data: z.object({
        prepaid_balance: z.number().finite(),
        free_balance: z.number().finite().nonnegative(),
        free_grants: z
          .array(
            z.object({ amount: z.number().finite(), expires_at: z.string() }),
          )
          .default([]),
      }),
    })
    .parse(await response.json());
  const after = await ledger();
  const grants = createHash("sha256")
    .update(
      JSON.stringify(
        data.free_grants.sort((a, b) =>
          a.expires_at.localeCompare(b.expires_at),
        ),
      ),
    )
    .digest("hex");
  const debit = latest
    ? Number(latest.prepaid_usd) +
      Number(latest.free_usd) -
      data.prepaid_balance -
      data.free_balance
    : 0;
  const delta = latest ? Number(after.usd) - Number(latest.ledger_usd) : 0;
  const matched =
    latest &&
    latest.state !== "review" &&
    JSON.stringify(before) === JSON.stringify(after) &&
    after.unresolved === "0" &&
    Number(latest.unresolved) === 0 &&
    grants === latest.grants_hash &&
    debit >= 0 &&
    Math.abs(debit - delta) < 0.0000001;
  await db.query(
    `INSERT INTO x_credit_snapshots(prepaid_usd,free_usd,grants_hash,ledger_usd,requests,unresolved,state)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      data.prepaid_balance,
      data.free_balance,
      grants,
      after.usd,
      after.requests,
      after.unresolved,
      !latest ? "baseline" : matched ? "matched" : "review",
    ],
  );
}
