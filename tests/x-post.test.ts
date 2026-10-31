import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("X source lookups preserve public context, cache safely and bound paid attempts", async (t) => {
  // Isolate accounting from every other test and the orb's preview database.
  const schema = `x_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const original = { ...process.env };
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(process.env.DATABASE_URL!);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  process.env.X_API_BEARER_TOKEN = "test-only-not-a-real-key";
  process.env.X_API_MONTHLY_BUDGET_USD = "5";
  const { db } = await import("../src/lib/server/db");
  const { sourcePost: lookup } = await import("../src/lib/server/x-post");
  const ownerId = randomUUID();
  const sourcePost = (url: string) => lookup(ownerId, url);
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    for (const name of [
      "DATABASE_URL",
      "X_API_BEARER_TOKEN",
      "X_API_MONTHLY_BUDGET_USD",
    ]) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });
  await db.query(await readFile("migrations/011_x_source_posts.sql", "utf8"));
  await db.query("CREATE TABLE users(id uuid PRIMARY KEY)");
  await db.query(await readFile("migrations/013_api_usage.sql", "utf8"));
  await db.query(await readFile("migrations/004_feature_access.sql", "utf8"));
  await db.query(
    "CREATE TABLE invites(used_at timestamptz,revoked_at timestamptz)",
  );
  await db.query(await readFile("migrations/016_plans.sql", "utf8"));
  await db.query(
    await readFile("migrations/023_x_cost_accounting.sql", "utf8"),
  );
  await db.query("INSERT INTO users(id) VALUES($1)", [ownerId]);
  let calls = 0;
  let status = 200;
  let text = "Short text";
  let protectedAuthor = false;
  let edited = false;
  let maliciousMedia = false;
  t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    calls++;
    assert.equal(input.origin, "https://api.x.com");
    assert.equal(
      input.searchParams.get("expansions"),
      "author_id,attachments.media_keys",
    );
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer test-only-not-a-real-key",
    );
    assert.equal(new Headers(init.headers).has("Referer"), false);
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    const id = input.pathname.split("/").at(-1)!;
    // These are deliberately in the opposite order from the attachment keys.
    return Response.json(
      {
        data: {
          id,
          author_id: "42",
          text: "truncated",
          created_at: "2026-10-01T08:30:00.000Z",
          edit_history_tweet_ids: edited ? ["1", id] : [id],
          note_tweet: {
            text,
            entities: {
              urls: [
                {
                  url: "https://t.co/test",
                  expanded_url: "https://example.com/full",
                  display_url: "example.com/full",
                },
              ],
            },
          },
          attachments: { media_keys: ["photo", "video"] },
        },
        includes: {
          users: [
            {
              id: "99",
              name: "Wrong",
              username: "wrong",
              protected: false,
              profile_image_url: "https://pbs.twimg.com/wrong.jpg",
            },
            {
              id: "42",
              name: "Source author",
              username: "source",
              protected: protectedAuthor,
              profile_image_url: "https://pbs.twimg.com/avatar.jpg",
            },
          ],
          media: [
            {
              media_key: "video",
              type: "video",
              preview_image_url: "https://pbs.twimg.com/preview.jpg",
              variants: [
                {
                  content_type: "application/x-mpegURL",
                  url: "https://video.twimg.com/list.m3u8",
                },
                {
                  content_type: "video/mp4",
                  url: maliciousMedia
                    ? "https://evil.example/video.mp4"
                    : "https://video.twimg.com/high.mp4",
                  bit_rate: 2000,
                },
                {
                  content_type: "video/mp4",
                  url: "https://video.twimg.com/low.mp4",
                  bit_rate: 1000,
                },
              ],
            },
            {
              media_key: "photo",
              type: "photo",
              url: "https://pbs.twimg.com/photo.jpg",
              alt_text: "A source photo",
            },
          ],
        },
      },
      { status },
    );
  });
  const url = (id: number) => `https://x.com/source/status/${id}`;
  const expire = (id: number) =>
    db.query(
      "UPDATE x_source_posts SET expires_at=now()-interval '1 second' WHERE post_id=$1",
      [String(id)],
    );
  assert.equal(await sourcePost("https://evil.example/status/1"), null);
  process.env.X_API_MONTHLY_BUDGET_USD = "0";
  assert.equal(await sourcePost(url(1)), null);
  process.env.X_API_MONTHLY_BUDGET_USD = "invalid";
  assert.equal(await sourcePost(url(1)), null);
  process.env.X_API_MONTHLY_BUDGET_USD = "5";
  delete process.env.X_API_BEARER_TOKEN;
  assert.equal(await sourcePost(url(1)), null);
  process.env.X_API_BEARER_TOKEN = "test-only-not-a-real-key";
  assert.equal(calls, 0);
  assert.equal(
    await sourcePost(url(1)),
    null,
    "accounts default to no X access",
  );
  assert.equal(calls, 0, "denied lookups never reach X");
  await db.query(
    "UPDATE users SET plan='pro',pro_limits=jsonb_set(pro_limits,'{x_usd}','10') WHERE id=$1",
    [ownerId],
  );

  const card = await sourcePost(url(1));
  assert.equal(
    card?.text,
    "Short text",
    "use full note text, not truncated text",
  );
  assert.equal(card?.author.username, "source");
  assert.deepEqual(card?.links, [
    {
      text: "https://t.co/test",
      url: "https://t.co/test",
      label: "example.com/full",
    },
  ]);
  assert.deepEqual(
    card?.media.map((item) => [item.type, item.url, item.alt]),
    [
      ["photo", "https://pbs.twimg.com/photo.jpg", "A source photo"],
      ["video", "https://video.twimg.com/high.mp4", ""],
    ],
  );
  assert.deepEqual(
    await sourcePost("https://twitter.com/other/status/1?s=20"),
    JSON.parse(JSON.stringify(card)),
  );
  assert.equal(
    calls,
    1,
    "aliases and different handles reuse the post-ID cache",
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT user_id,outcome,estimated_usd::float8 AS cost,reserved_cents FROM api_usage",
      )
    ).rows,
    [{ user_id: ownerId, outcome: "success", cost: 0.005, reserved_cents: 5 }],
  );
  await db.query("UPDATE users SET plan='free' WHERE id=$1", [ownerId]);
  assert.equal(
    await sourcePost(url(1)),
    null,
    "revocation also blocks fresh cached cards",
  );
  assert.equal(calls, 1);
  await db.query("UPDATE users SET plan='pro' WHERE id=$1", [ownerId]);
  text = "An updated source";
  await expire(1);
  assert.equal((await sourcePost(url(1)))?.text, text);
  assert.equal(
    Number(
      (await db.query("SELECT sum(estimated_usd) AS usd FROM api_usage"))
        .rows[0].usd,
    ),
    0.005,
    "Refreshing a cached resource on the same UTC day must not double charge",
  );
  status = 404;
  await expire(1);
  assert.equal(
    await sourcePost(url(1)),
    null,
    "never serve stale deleted content",
  );
  assert.equal(await sourcePost(url(1)), null);
  assert.equal(
    calls,
    3,
    "failed lookups back off rather than charging on every view",
  );
  status = 200;
  protectedAuthor = true;
  assert.equal(await sourcePost(url(2)), null);
  protectedAuthor = false;
  edited = true;
  assert.equal(await sourcePost(url(3)), null);
  edited = false;
  maliciousMedia = true;
  assert.equal(await sourcePost(url(4)), null);
  maliciousMedia = false;

  const before = calls;
  await Promise.all(Array.from({ length: 12 }, () => sourcePost(url(5))));
  assert.equal(
    calls,
    before + 1,
    "simultaneous cache misses make one paid request",
  );
  assert.equal((await sourcePost(url(5)))?.text, text);
  // Only one of two DIFFERENT source IDs can spend the final five cents.
  const spent = Number(
    (await db.query("SELECT reserved_cents FROM x_api_budgets")).rows[0]
      .reserved_cents,
  );
  assert.equal(
    spent,
    calls * 5,
    "failed requests retain their committed budget reservation",
  );
  process.env.X_API_MONTHLY_BUDGET_USD = ((spent + 5) / 100).toFixed(2);
  const results = await Promise.all([sourcePost(url(6)), sourcePost(url(7))]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    Number(
      (await db.query("SELECT reserved_cents FROM x_api_budgets")).rows[0]
        .reserved_cents,
    ),
    spent + 5,
  );
  assert.equal(await sourcePost(url(8)), null);
  assert.equal(
    (await sourcePost(url(5)))?.text,
    text,
    "fresh cached cards remain usable at the budget",
  );
  const usage = await db.query(
    "SELECT count(*)::int AS requests, sum(reserved_cents)::int AS reserved, count(*) FILTER(WHERE outcome='error' AND estimated_usd IS NULL)::int AS unpriced_failures FROM api_usage",
  );
  assert.deepEqual(usage.rows[0], {
    requests: calls,
    reserved: spent + 5,
    unpriced_failures: 0,
  });
});
