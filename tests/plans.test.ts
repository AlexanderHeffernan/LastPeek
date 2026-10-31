import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { monthlyPeriod } from "../src/lib/plans";

test("plan entitlements protect current periods, enforce quotas and preserve usage across toggles", async (t) => {
  const original = process.env.DATABASE_URL!;
  const schema = `plans_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: original });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(original);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  const { db, transaction } = await import("../src/lib/server/db");
  const {
    entitlement,
    setPlan,
    setAllowances,
    planAllowances,
    claimDraft,
    planUsage,
  } = await import("../src/lib/server/plans");
  const { startOpenAIUsage, finishOpenAIUsage } =
    await import("../src/lib/server/usage");
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = original;
  });
  const migrations = (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations.filter((name) => name !== "016_plans.sql"))
    await db.query(await readFile(`migrations/${name}`, "utf8"));
  const existing = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,'existing@example.test','Existing','unused')",
    [existing],
  );
  await db.query(
    "INSERT INTO invites(id,hash,created_by,expires_at) VALUES($1,'old-link',$2,now()+interval '1 day')",
    [randomUUID(), existing],
  );
  await db.query(await readFile("migrations/016_plans.sql", "utf8"));
  assert.equal(
    (await entitlement(existing)).plan,
    "pro",
    "Existing authors migrate to Pro.",
  );
  assert.ok(
    (await db.query("SELECT revoked_at FROM invites")).rows[0].revoked_at,
  );
  const free = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,'free@example.test','Free','unused')",
    [free],
  );
  assert.equal((await entitlement(free)).plan, "free");
  await assert.rejects(
    startOpenAIUsage(free, "gpt-6-luna"),
    (cause) => (cause as { status: number }).status === 403,
  );
  const catalog = await planAllowances();
  const originalPeriod = await entitlement(existing);
  await setAllowances(existing, "pro", {
    ...catalog.pro,
    drafts: 12,
    storage_mb: 500,
    ai_usd: 0.25,
    x_usd: 2,
  });
  let current = await entitlement(existing);
  assert.equal(current.limits.drafts, 100);
  assert.equal(current.limits.storage_mb, 2048);
  assert.equal(current.limits.ai_usd, 0.5);
  assert.equal(
    current.limits.x_usd,
    2,
    "Increases apply even alongside reductions.",
  );
  assert.equal(current.nextLimits.drafts, 12);
  assert.equal(current.end, originalPeriod.end);
  const usageId = await startOpenAIUsage(existing, "gpt-6-luna");
  await finishOpenAIUsage(usageId, { outcome: "error" });
  assert.equal(
    (await planUsage(existing)).ai,
    0.03,
    "Unknown charges retain their reservation.",
  );
  await setPlan(existing, existing, "free", false);
  await setPlan(existing, existing, "pro", false);
  assert.equal((await planUsage(existing)).ai, 0.03);
  assert.equal((await entitlement(existing)).start, originalPeriod.start);
  await setPlan(existing, existing, "free", true);
  assert.equal((await entitlement(existing)).plan, "pro");
  await setPlan(existing, existing, "pro", false);
  assert.equal((await entitlement(existing)).downgradeAtEnd, false);
  await db.query(
    "UPDATE users SET plan_anchor=now()-interval '2 months',period_end=now()-interval '1 second' WHERE id=$1",
    [existing],
  );
  current = await entitlement(existing);
  assert.equal(current.limits.drafts, 12);
  assert.equal(current.limits.ai_usd, 0.25);
  assert.equal(
    (await planUsage(existing)).ai,
    0,
    "Renewal starts a new allowance period.",
  );
  await setPlan(existing, existing, "free", true);
  await db.query(
    "UPDATE users SET period_end=now()-interval '1 second' WHERE id=$1",
    [existing],
  );
  assert.equal((await entitlement(existing)).plan, "free");
  await setAllowances(existing, "free", { ...catalog.free, drafts: 1 });
  const create = () =>
    transaction(async (client) => {
      await claimDraft(client, free);
      await client.query(
        "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,'{}')",
        [randomUUID(), free],
      );
    });
  const results = await Promise.allSettled([create(), create()]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  await setAllowances(existing, "free", { ...catalog.free, drafts: 0 });
  await assert.rejects(create());
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM drafts WHERE owner_id=$1",
        [free],
      )
    ).rows[0].n,
    1,
    "Reductions preserve existing drafts.",
  );
  await db.query("DELETE FROM drafts WHERE owner_id=$1", [free]);
  await setAllowances(existing, "free", { ...catalog.free, drafts: 1 });
  await create();
  for (const [now, start, end] of [
    [
      "2027-02-28T09:00:00Z",
      "2027-02-28T08:00:00.000Z",
      "2027-03-31T08:00:00.000Z",
    ],
    [
      "2027-03-31T07:59:59Z",
      "2027-02-28T08:00:00.000Z",
      "2027-03-31T08:00:00.000Z",
    ],
    [
      "2027-03-31T08:00:00Z",
      "2027-03-31T08:00:00.000Z",
      "2027-04-30T08:00:00.000Z",
    ],
  ]) {
    const period = monthlyPeriod(
      new Date("2027-01-31T08:00:00Z"),
      new Date(now),
    );
    assert.equal(period.start.toISOString(), start);
    assert.equal(period.end.toISOString(), end);
  }
});
