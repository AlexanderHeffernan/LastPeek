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
  const {
    startOpenAIUsage,
    finishOpenAIUsage,
    apiUsage,
    usageByUsers,
    xEstimatedCost,
  } = await import("../src/lib/server/usage");
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
  const raw = {
    data: { id: "1" },
    includes: { users: [{}, {}], media: [{}, {}, {}] },
  };
  assert.equal(xEstimatedCost(raw, new Date("2026-11-21T23:59:59Z")), 0.005);
  assert.equal(xEstimatedCost(raw, new Date("2026-11-22T00:00:00Z")), 0.04);
  assert.equal(xEstimatedCost({ errors: [] }), null);

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
