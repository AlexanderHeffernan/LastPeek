import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

test("usage attributes requests, snapshots rates and distinguishes unknown costs across UTC months", async (t) => {
  const schema = `usage_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const original = process.env.DATABASE_URL;
  const connection = new URL(original!);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  const { db } = await import("../src/lib/server/db");
  const { startOpenAIUsage, finishOpenAIUsage, apiUsage, usageByUsers } =
    await import("../src/lib/server/usage");
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = original;
  });
  await db.query(
    "CREATE TABLE users(id uuid PRIMARY KEY,email text); CREATE TABLE schema_migrations(name text,applied_at timestamptz DEFAULT now()); INSERT INTO schema_migrations(name) VALUES('013_api_usage.sql')",
  );
  await db.query(await readFile("migrations/011_x_source_posts.sql", "utf8"));
  await db.query(await readFile("migrations/013_api_usage.sql", "utf8"));
  await db.query(await readFile("migrations/004_feature_access.sql", "utf8"));
  await db.query(
    "CREATE TABLE invites(used_at timestamptz,revoked_at timestamptz)",
  );
  await db.query(await readFile("migrations/016_plans.sql", "utf8"));
  await db.query(
    await readFile("migrations/023_x_cost_accounting.sql", "utf8"),
  );
  const a = randomUUID(),
    b = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,plan) VALUES($1,'a@example.test','pro'),($2,'b@example.test','pro')",
    [a, b],
  );
  const first = await startOpenAIUsage(a, "gpt-6-luna");
  await finishOpenAIUsage(first, {
    outcome: "success",
    inputTokens: 1000,
    cachedInputTokens: 250,
    cacheWriteTokens: 100,
    outputTokens: 70,
  });
  // A repeated completion cannot alter the original request or its captured price.
  await finishOpenAIUsage(first, { outcome: "error" });
  assert.equal(
    Number(
      (
        await db.query("SELECT estimated_usd FROM api_usage WHERE id=$1", [
          first,
        ])
      ).rows[0].estimated_usd,
    ),
    0.000115,
  );
  const second = await startOpenAIUsage(b, "gpt-6-luna");
  await finishOpenAIUsage(second, {
    outcome: "success",
    inputTokens: 200,
    outputTokens: 10,
  });
  await assert.rejects(startOpenAIUsage(a, "unpriced"));
  const unpriced = randomUUID();
  await db.query(
    "INSERT INTO api_usage(id,user_id,provider,model) VALUES($1,$2,'openai','historically-unpriced')",
    [unpriced, a],
  );
  await finishOpenAIUsage(unpriced, {
    outcome: "success",
    inputTokens: 20,
    outputTokens: 3,
  });
  await finishOpenAIUsage(await startOpenAIUsage(a, "gpt-6-luna"), {
    outcome: "error",
    httpStatus: 429,
  });
  await startOpenAIUsage(a, "gpt-6-luna");
  await db.query(
    "UPDATE api_usage SET created_at=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second' WHERE id=$1",
    [first],
  );
  await db.query(
    "INSERT INTO x_api_budgets(month,reserved_cents) VALUES(date_trunc('month',now() AT TIME ZONE 'UTC')::date,50)",
  );
  const all = await apiUsage({ period: "all", userId: a });
  assert.equal(all.account, "a@example.test");
  assert.deepEqual(all.providers[0], {
    provider: "openai",
    requests: 4,
    successful: 2,
    failed: 1,
    pending: 1,
    unpriced: 3,
    input_tokens: 1020,
    cached_input_tokens: 250,
    cache_write_tokens: 100,
    output_tokens: 73,
    estimated_usd: 0.000115,
    cost_usd: null,
    reserved_usd: 0,
  });
  const month = await apiUsage({ period: "month", userId: a });
  assert.equal(month.providers[0].requests, 3);
  assert.equal(month.providers[0].estimated_usd, 0);
  assert.equal(
    month.providers[0].unpriced,
    3,
    "Unknown cost must remain visible alongside a zero known subtotal.",
  );
  const batch = await usageByUsers([a, b]);
  assert.deepEqual(batch.get(a), month.providers);
  assert.equal(batch.get(b)![0].estimated_usd, 0.000025);
  // Long-context pricing applies to the whole request only above 272K tokens.
  for (const [inputTokens, expected] of [
    [272000, 0.027246],
    [272001, 0.0544672],
  ]) {
    const id = await startOpenAIUsage(b, "gpt-6-luna");
    await finishOpenAIUsage(id, {
      outcome: "success",
      inputTokens,
      cachedInputTokens: 100,
      cacheWriteTokens: 200,
      outputTokens: 100,
    });
    assert.equal(
      Number(
        (
          await db.query("SELECT estimated_usd FROM api_usage WHERE id=$1", [
            id,
          ])
        ).rows[0].estimated_usd,
      ),
      expected,
    );
  }
  assert.equal((await apiUsage({ period: "month" })).legacyXReservedUsd, 0.5);
  // The billable candidate is withheld if any request is unsettled. A safety
  // reservation must never be presented as a provider charge.
  await db.query(
    `INSERT INTO api_usage(id,user_id,provider,model,outcome,estimated_usd,reserved_usd,reserved_cents,created_at) VALUES
    ($1,$7,'x','post-create','success',0.015,0.015,2,now()),
    ($2,$7,'x','post-create','success',0,0.2,20,now()),
    ($3,$7,'x','media-upload','error',NULL,0.05,5,now()),
    ($4,$7,'x','media-upload','pending',NULL,NULL,5,now()),
    ($5,$7,'x','post-create','incomplete',NULL,0.2,20,(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second'),
    ($6,$8,'x','post-create','success',0.2,0.2,20,now())`,
    [...Array.from({ length: 6 }, randomUUID), a, b],
  );
  const xMonth = await apiUsage({ period: "month", userId: a });
  assert.equal(xMonth.providers[1].estimated_usd, 0.015);
  assert.equal(xMonth.providers[1].cost_usd, null);
  assert.deepEqual(
    xMonth.operations
      .filter((row) => row.provider === "x")
      .map((row) => ({
        operation: row.operation,
        requests: row.requests,
        failed: row.failed,
        pending: row.pending,
        cost: row.cost_usd,
      })),
    [
      {
        operation: "media-upload",
        requests: 2,
        failed: 1,
        pending: 1,
        cost: null,
      },
      {
        operation: "post-create",
        requests: 2,
        failed: 0,
        pending: 0,
        cost: 0.015,
      },
    ],
  );
  assert.equal(
    (await apiUsage({ period: "all", userId: a })).providers[1].cost_usd,
    null,
  );
  assert.deepEqual((await usageByUsers([a])).get(a), xMonth.providers);

  const { finishXRead, xReadRates, syncXCredits, xPricingBasis } =
    await import("../src/lib/server/x-usage");
  const read = async (
    userId: string,
    day: string,
    raw: unknown,
    status: number | null = 200,
  ) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO api_usage(id,user_id,provider,model,created_at,x_unit_usd,x_pricing_basis,x_read_rates)
       VALUES($1,$2,'x','post-lookup',$3,0.005,$4,$5)`,
      [id, userId, day, xPricingBasis, xReadRates(new Date(day))],
    );
    await finishXRead(
      id,
      "Post",
      raw,
      status,
      status === 200 ? "success" : "error",
    );
    return (
      await db.query(
        "SELECT estimated_usd::float8 AS usd FROM api_usage WHERE id=$1",
        [id],
      )
    ).rows[0].usd;
  };
  const raw = {
    data: { id: "501" },
    includes: {
      users: [{ id: "601" }, { id: "602" }],
      media: [{ media_key: "a" }, { media_key: "b" }, { media_key: "c" }],
    },
  };
  assert.equal(await read(a, "2026-11-21T23:59:59Z", raw), 0.005);
  assert.equal(
    await read(b, "2026-11-22T00:00:00Z", raw),
    0.04,
    "New UTC day and expansion tariff boundary both apply",
  );
  assert.equal(
    await read(a, "2026-11-22T18:00:00Z", raw),
    0,
    "Shared payer dedup applies across LastPeek users, not just one account",
  );
  const concurrent = await Promise.all(
    [a, b].map((userId) => read(userId, "2026-11-23T01:00:00Z", raw)),
  );
  assert.equal(
    concurrent.reduce((sum, cost) => sum + cost, 0),
    0.04,
    "Concurrent resource reads must not duplicate charges",
  );
  assert.equal(await read(a, "2026-11-24T00:00:00Z", {}, 403), 0);
  assert.equal(await read(a, "2026-11-24T00:00:00Z", undefined, null), null);
  assert.equal(
    await read(a, "2026-11-24T00:00:00Z", {
      data: { id: "502" },
      includes: { users: [{ id: "601" }], media: [{ media_key: "a" }] },
    }),
    0.02,
  );
  assert.equal(
    await read(b, "2026-11-24T00:00:01Z", {
      data: { id: "503" },
      includes: { users: [{ id: "601" }], media: [{ media_key: "b" }] },
    }),
    0.01,
    "Only overlapping resources deduplicate; different posts/media still charge",
  );

  // Real balance parsing/ledger comparison, without making any real X calls.
  const oldKey = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = "test-only";
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: { prepaid_balance: 10, free_balance: 0, free_grants: [] },
    }),
  );
  try {
    await syncXCredits();
    assert.equal(
      (await apiUsage({ period: "all" })).xBalance?.state,
      "baseline",
    );
    await db.query(
      "UPDATE x_credit_snapshots SET observed_at=now()-interval '6 minutes'",
    );
    await syncXCredits();
    assert.equal(
      (await apiUsage({ period: "all" })).xBalance?.state,
      "review",
      "Unknown historical charges cannot become a matched account",
    );
    // Clean, stable control interval including negative prepaid balances.
    await db.query(
      "DELETE FROM x_credit_snapshots; UPDATE api_usage SET estimated_usd=0 WHERE provider='x'",
    );
    fetchMock.mock.mockImplementation(async () =>
      Response.json({
        data: { prepaid_balance: -0.1, free_balance: 0, free_grants: [] },
      }),
    );
    await syncXCredits();
    await db.query(
      "UPDATE x_credit_snapshots SET observed_at=now()-interval '6 minutes'",
    );
    await db.query("UPDATE api_usage SET estimated_usd=0.015 WHERE id=$1", [
      (await db.query("SELECT id FROM api_usage WHERE provider='x' LIMIT 1"))
        .rows[0].id,
    ]);
    fetchMock.mock.mockImplementation(async () =>
      Response.json({
        data: { prepaid_balance: -0.115, free_balance: 0, free_grants: [] },
      }),
    );
    await syncXCredits();
    assert.equal(
      (await apiUsage({ period: "all" })).xBalance?.state,
      "matched",
    );
    await db.query(
      "UPDATE x_credit_snapshots SET observed_at=now()-interval '6 minutes'",
    );
    fetchMock.mock.mockImplementation(async () =>
      Response.json({
        data: { prepaid_balance: 20, free_balance: 0, free_grants: [] },
      }),
    );
    await syncXCredits();
    assert.equal(
      (await apiUsage({ period: "all" })).xBalance?.state,
      "review",
      "Topups are not negative user spending",
    );
    await db.query(
      "UPDATE x_credit_snapshots SET observed_at=now()-interval '6 minutes'",
    );
    await syncXCredits();
    assert.equal(
      (await apiUsage({ period: "all" })).xBalance?.state,
      "review",
      "A quiet interval must not erase an earlier discrepancy",
    );
  } finally {
    fetchMock.mock.restore();
    if (oldKey === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = oldKey;
  }

  const { setFeatureAccess } = await import("../src/lib/server/features");
  await assert.rejects(
    setFeatureAccess("a@example.test", "ai-review", true, "test"),
  );
  await assert.rejects(
    setFeatureAccess("a@example.test", "x-source-posts", true, "test"),
  );
  const c = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,plan,pro_limits) VALUES($1,'c@example.test','pro',$2)",
    [
      c,
      {
        drafts: 100,
        storage_mb: 2048,
        upload_mb: 50,
        ai_usd: 0.03,
        x_usd: 1.5,
      },
    ],
  );
  const claims = await Promise.allSettled([
    startOpenAIUsage(c, "gpt-6-luna"),
    startOpenAIUsage(c, "gpt-6-luna"),
  ]);
  assert.equal(
    claims.filter((result) => result.status === "fulfilled").length,
    1,
    "Concurrent requests cannot overspend a one-request allowance.",
  );
  const successful = claims.find(
    (result) => result.status === "fulfilled",
  ) as PromiseFulfilledResult<string>;
  await finishOpenAIUsage(successful.value, {
    outcome: "success",
    inputTokens: 1000,
    outputTokens: 100,
  });
  assert.ok(
    (await startOpenAIUsage(c, "gpt-6-luna").catch(() => null)) === null,
    "A known charge plus a full reservation must still fit the allowance.",
  );
});
