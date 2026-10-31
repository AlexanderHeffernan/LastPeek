import { randomUUID } from "node:crypto";
import { db } from "./db";
import {
  usageQuery,
  type APIUsage,
  type UsageQuery,
  type UsageData,
} from "../usage";

export type AIUsageReport = {
  outcome: "success" | "error" | "incomplete";
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  httpStatus?: number;
};

export async function startOpenAIUsage(userId: string, model: string) {
  const id = randomUUID();
  // Standard USD / 1M tokens, verified 2026-10-31:
  // https://developers.openai.com/api/docs/models/gpt-6-luna
  // Unknown models stay unpriced instead of borrowing another model's rates.
  const rates = model === "gpt-6-luna" ? [0.1, 0.01, 0.5] : [null, null, null];
  // Snapshot before sending: future catalog changes never rewrite history.
  await db.query(
    `INSERT INTO api_usage(id,user_id,provider,model,input_usd,cached_input_usd,output_usd)
    VALUES($1,$2,'openai',$3,$4,$5,$6)`,
    [id, userId, model, ...rates],
  );
  return id;
}

export async function finishOpenAIUsage(id: string, usage: AIUsageReport) {
  await db.query(
    `UPDATE api_usage SET outcome=$2,input_tokens=$3,cached_input_tokens=$4,
    output_tokens=$5,http_status=$6,cache_write_tokens=$7,completed_at=now(),
    estimated_usd=((($3::bigint-$4::bigint-$7::bigint)*input_usd
      +$4::bigint*cached_input_usd+$7::bigint*input_usd*1.25)*CASE WHEN $3::bigint>272000 THEN 2 ELSE 1 END
      +$5::bigint*output_usd*CASE WHEN $3::bigint>272000 THEN 1.5 ELSE 1 END)/1000000
    WHERE id=$1 AND outcome='pending'`,
    [
      id,
      usage.outcome,
      usage.inputTokens ?? null,
      usage.inputTokens === undefined ? null : (usage.cachedInputTokens ?? 0),
      usage.outputTokens ?? null,
      usage.httpStatus ?? null,
      usage.inputTokens === undefined ? null : (usage.cacheWriteTokens ?? 0),
    ],
  );
}

// Gross public PPU estimate, before X's daily deduplication or account-specific adjustments.
// Expansion charging starts 22 November 2026, not on the announcement date.
export function xEstimatedCost(raw: unknown, date = new Date()) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("data" in raw) ||
    !raw.data ||
    typeof raw.data !== "object"
  )
    return null;
  const includes =
    "includes" in raw && raw.includes && typeof raw.includes === "object"
      ? (raw.includes as Record<string, unknown>)
      : {};
  const count = (key: string) =>
    Array.isArray(includes[key]) ? includes[key].length : 0;
  return (
    0.005 +
    (date >= new Date("2026-11-22T00:00:00Z")
      ? count("users") * 0.01 +
        (count("media") + count("polls") + count("places") + count("tweets")) *
          0.005
      : 0)
  );
}

const sums = `count(*)::float8 AS requests,
  count(*) FILTER(WHERE outcome='success')::float8 AS successful,
  count(*) FILTER(WHERE outcome IN ('error','incomplete','unusable'))::float8 AS failed,
  count(*) FILTER(WHERE outcome='pending')::float8 AS pending,
  count(*) FILTER(WHERE estimated_usd IS NULL)::float8 AS unpriced,
  COALESCE(sum(input_tokens),0)::float8 AS input_tokens,
  COALESCE(sum(cached_input_tokens),0)::float8 AS cached_input_tokens,
  COALESCE(sum(cache_write_tokens),0)::float8 AS cache_write_tokens,
  COALESCE(sum(output_tokens),0)::float8 AS output_tokens,
  COALESCE(sum(estimated_usd),0)::float8 AS estimated_usd,
  COALESCE(sum(reserved_cents),0)::float8/100 AS reserved_usd`;
const monthStart = `date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
function providers(rows: APIUsage[]): APIUsage[] {
  return (["openai", "x"] as const).map(
    (provider) =>
      rows.find((row) => row.provider === provider) ?? {
        provider,
        requests: 0,
        successful: 0,
        failed: 0,
        pending: 0,
        unpriced: 0,
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_write_tokens: 0,
        output_tokens: 0,
        estimated_usd: 0,
        reserved_usd: 0,
      },
  );
}

export async function apiUsage(input: UsageQuery): Promise<UsageData> {
  const query = usageQuery.parse(input);
  const result = await db.query<APIUsage>(
    `SELECT provider,${sums} FROM api_usage
    WHERE ($1::uuid IS NULL OR user_id=$1) AND ($2='all' OR created_at>=${monthStart}) GROUP BY provider`,
    [query.userId ?? null, query.period],
  );
  const [tracking, legacy, account] = await Promise.all([
    db.query(
      "SELECT applied_at FROM schema_migrations WHERE name='013_api_usage.sql'",
    ),
    db.query(
      `SELECT GREATEST(0,(SELECT COALESCE(sum(reserved_cents),0) FROM x_api_budgets WHERE $1='all' OR month=date_trunc('month',now() AT TIME ZONE 'UTC')::date)
      -(SELECT COALESCE(sum(reserved_cents),0) FROM api_usage WHERE provider='x' AND ($1='all' OR created_at>=${monthStart})))::float8/100 AS amount`,
      [query.period],
    ),
    query.userId
      ? db.query("SELECT email FROM users WHERE id=$1", [query.userId])
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    ...query,
    account: query.userId
      ? (account.rows[0]?.email ?? "Deleted or unknown account")
      : null,
    trackingSince: tracking.rows[0].applied_at.toISOString(),
    providers: providers(result.rows),
    legacyXReservedUsd: query.userId ? 0 : legacy.rows[0].amount,
  };
}

export async function usageByUsers(ids: string[]) {
  const result = await db.query<APIUsage & { user_id: string }>(
    `SELECT user_id,provider,${sums} FROM api_usage
    WHERE user_id=ANY($1::uuid[]) AND created_at>=${monthStart} GROUP BY user_id,provider`,
    [ids],
  );
  return new Map(
    ids.map((id) => [
      id,
      providers(
        result.rows
          .filter((row) => row.user_id === id)
          .map(({ user_id, ...usage }) => usage),
      ),
    ]),
  );
}
