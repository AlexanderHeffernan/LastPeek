import { error } from "@sveltejs/kit";
import type { PoolClient } from "pg";
import { db, transaction } from "./db";
import {
  allowanceSchema,
  monthlyPeriod,
  type Plan,
  type Allowances,
  type Entitlement,
} from "../plans";

export async function planAllowances() {
  const rows = await db.query(
    "SELECT plan,limits FROM plan_allowances ORDER BY plan",
  );
  return Object.fromEntries(
    rows.rows.map((row) => [row.plan, allowanceSchema.parse(row.limits)]),
  ) as Record<Plan, Allowances>;
}

// The user lock serializes entitlement refresh, quota claims and administrative changes.
export async function entitlementIn(
  client: PoolClient,
  userId: string,
): Promise<Entitlement> {
  const row = (
    await client.query(
      "SELECT plan,plan_anchor,period_start,period_end,pro_limits,downgrade_at_end FROM users WHERE id=$1 FOR UPDATE",
      [userId],
    )
  ).rows[0];
  if (!row) error(404, "Account not found.");
  const now = (await client.query("SELECT now() AS now")).rows[0].now as Date;
  if (row.period_end <= now) {
    const period = monthlyPeriod(row.plan_anchor, now);
    if (row.downgrade_at_end) row.plan = "free";
    row.period_start = period.start;
    row.period_end = period.end;
    row.downgrade_at_end = false;
    row.pro_limits = (
      await client.query("SELECT limits FROM plan_allowances WHERE plan='pro'")
    ).rows[0].limits;
    await client.query(
      "UPDATE users SET plan=$2,period_start=$3,period_end=$4,pro_limits=$5,downgrade_at_end=false WHERE id=$1",
      [userId, row.plan, period.start, period.end, row.pro_limits],
    );
  }
  const next = allowanceSchema.parse(
    (
      await client.query("SELECT limits FROM plan_allowances WHERE plan=$1", [
        row.downgrade_at_end ? "free" : row.plan,
      ])
    ).rows[0].limits,
  );
  const limits =
    row.plan === "pro" ? allowanceSchema.parse(row.pro_limits) : next;
  return {
    plan: row.plan,
    limits,
    nextLimits: next,
    start: row.period_start.toISOString(),
    end: row.period_end.toISOString(),
    downgradeAtEnd: row.downgrade_at_end,
  };
}
export const entitlement = (userId: string) =>
  transaction((client) => entitlementIn(client, userId));
export async function isPro(userId: string) {
  return (await entitlement(userId)).plan === "pro";
}
export async function planUsage(userId: string) {
  return transaction(async (client) => {
    const access = await entitlementIn(client, userId);
    const row = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM drafts WHERE owner_id=$1) AS drafts,
      ((SELECT COALESCE(sum(bytes),0) FROM media WHERE owner_id=$1)+(SELECT COALESCE(sum(bytes),0) FROM avatars WHERE owner_id=$1))::float8 AS bytes,
      (SELECT COALESCE(sum(COALESCE(estimated_usd,reserved_usd)),0)::float8 FROM api_usage WHERE user_id=$1 AND period_start=$2 AND provider='openai') AS ai,
      (SELECT COALESCE(sum(COALESCE(estimated_usd,reserved_usd)),0)::float8 FROM api_usage WHERE user_id=$1 AND period_start=$2 AND provider='x') AS x`,
        [userId, access.start],
      )
    ).rows[0];
    return { ...access, ...row };
  });
}
export async function claimDraft(client: PoolClient, userId: string) {
  const access = await entitlementIn(client, userId);
  const count = Number(
    (
      await client.query("SELECT count(*) FROM drafts WHERE owner_id=$1", [
        userId,
      ])
    ).rows[0].count,
  );
  if (count >= access.limits.drafts)
    error(
      409,
      "Your draft allowance is full. Delete an old draft before creating another.",
    );
}
export async function reserveAPI(
  client: PoolClient,
  userId: string,
  provider: "openai" | "x",
  amount: number,
) {
  const access = await entitlementIn(client, userId);
  if (access.plan !== "pro") error(403, "This feature requires Pro.");
  const fits = (
    await client.query(
      "SELECT COALESCE(sum(COALESCE(estimated_usd,reserved_usd)),0)+$4::numeric<=$5::numeric AS fits FROM api_usage WHERE user_id=$1 AND period_start=$2 AND provider=$3",
      [
        userId,
        access.start,
        provider,
        amount,
        provider === "openai" ? access.limits.ai_usd : access.limits.x_usd,
      ],
    )
  ).rows[0].fits;
  if (!fits)
    error(
      429,
      "Your allowance is used or reserved by an ongoing request. Try after it finishes or when your allowance renews.",
    );
  return access.start;
}
export async function setPlan(
  actorId: string,
  userId: string,
  plan: Plan,
  atEnd: boolean,
) {
  await transaction(async (client) => {
    await entitlementIn(client, userId);
    if (atEnd && plan !== "free")
      error(400, "Only downgrades can be scheduled.");
    if (atEnd) {
      await client.query(
        "UPDATE users SET downgrade_at_end=(plan='pro') WHERE id=$1",
        [userId],
      );
    } else {
      // Never reset usage or dates on toggling plans. Upgrade uses at least the
      // current catalog; a previous Pro entitlement remains protected this period.
      const limits = (
        await client.query(
          "SELECT limits FROM plan_allowances WHERE plan='pro'",
        )
      ).rows[0].limits;
      const old = (
        await client.query("SELECT pro_limits FROM users WHERE id=$1", [userId])
      ).rows[0].pro_limits;
      const protectedLimits = Object.fromEntries(
        Object.entries(limits).map(([key, value]) => [
          key,
          Math.max(Number(value), old[key] ?? 0),
        ]),
      );
      await client.query(
        "UPDATE users SET plan=$2,downgrade_at_end=false,pro_limits=$3 WHERE id=$1",
        [userId, plan, protectedLimits],
      );
    }
    await client.query(
      "INSERT INTO plan_audit(actor_id,user_id,action,details) VALUES($1,$2,'plan',$3)",
      [actorId, userId, { plan, atEnd }],
    );
  });
}
export async function setAllowances(
  actorId: string,
  plan: Plan,
  raw: Allowances,
) {
  const limits = allowanceSchema.parse(raw);
  if (plan === "free" && (limits.ai_usd || limits.x_usd))
    error(400, "Paid API allowances belong to Pro.");
  await transaction(async (client) => {
    await client.query(
      "SELECT plan FROM plan_allowances WHERE plan=$1 FOR UPDATE",
      [plan],
    );
    await client.query("UPDATE plan_allowances SET limits=$2 WHERE plan=$1", [
      plan,
      limits,
    ]);
    if (plan === "pro") {
      // Catalog reductions wait for renewal; increases are effective immediately.
      const users = (
        await client.query(
          "SELECT id,pro_limits FROM users ORDER BY id FOR UPDATE",
        )
      ).rows;
      for (const user of users) {
        const increased = Object.fromEntries(
          Object.entries(limits).map(([key, value]) => [
            key,
            Math.max(value, user.pro_limits[key] ?? 0),
          ]),
        );
        await client.query("UPDATE users SET pro_limits=$2 WHERE id=$1", [
          user.id,
          increased,
        ]);
      }
    }
    await client.query(
      "INSERT INTO plan_audit(actor_id,action,details) VALUES($1,'allowances',$2)",
      [actorId, { plan, limits }],
    );
  });
}
