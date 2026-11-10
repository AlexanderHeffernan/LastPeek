import type { PoolClient } from "pg";
import { db } from "./db";

export async function xBudget(client: PoolClient | typeof db = db) {
  const result = await client.query(
    "SELECT monthly_limit_cents FROM x_api_settings WHERE id=true FOR SHARE",
  );
  const configured = process.env.X_API_MONTHLY_BUDGET_USD ?? "5";
  const limitCents: number | null =
    result.rows[0].monthly_limit_cents ??
    (/^\d{1,5}(?:\.\d{1,2})?$/.test(configured)
      ? Math.round(Number(configured) * 100)
      : null);
  return limitCents;
}

/** Shares the settings lock with other claims, but serializes against owner changes. */
export async function reserveXBudget(client: PoolClient, cents: number) {
  const limit = await xBudget(client);
  if (limit === null) return false;
  const result = await client.query(
    `INSERT INTO x_api_budgets(month,reserved_cents)
     SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date,$1::int WHERE $1::int<=$2::int
     ON CONFLICT(month) DO UPDATE SET reserved_cents=x_api_budgets.reserved_cents+$1
     WHERE x_api_budgets.reserved_cents+$1<=$2 RETURNING month`,
    [cents, limit],
  );
  return Boolean(result.rowCount);
}
