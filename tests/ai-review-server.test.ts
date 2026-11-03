import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

test("AI review history preserves private snapshots in newest-first order", async (t) => {
  const original = process.env.DATABASE_URL!;
  const oldKey = process.env.OPENAI_API_KEY;
  const schema = `ai_history_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: original });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(original);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  const { db } = await import("../src/lib/server/db");
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = original;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.query(await readFile(`migrations/${file}`, "utf8"));
  const { reviewDraft, draftReviews, deleteDraftReview } =
    await import("../src/lib/server/ai-review");
  const { createDraft, saveDraft, draftComments } =
    await import("../src/lib/server/drafts");
  const { setPlan } = await import("../src/lib/server/plans");
  const { blankContent } = await import("../src/lib/contracts");
  const [owner, outsider, id] = Array.from({ length: 3 }, () => randomUUID());
  for (const user of [owner, outsider])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Writer','unused')",
      [user, `${user}@example.test`],
    );
  await setPlan(owner, owner, "pro", false);
  const content = blankContent("Writer");
  content.posts[0].text = "Shipping on Frday.";
  await createDraft(id, owner, content);
  let calls = 0;
  let fail = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (fail) return new Response("unavailable", { status: 503 });
    return new Response(
      JSON.stringify({
        id: `resp_${calls}`,
        object: "response",
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 10 },
        output: [
          {
            type: "message",
            id: `msg_${calls}`,
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  summary: `Review ${calls}`,
                  findings: [
                    {
                      postId: content.posts[0].id,
                      category: "Typo",
                      feedback: "Correct the weekday.",
                      quote: "Frday",
                      replacement: "Friday",
                    },
                  ],
                }),
                annotations: [],
              },
            ],
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  const input = {
    type: "proofread",
    posts: content.posts.map(({ id, text }) => ({ id, text })),
  };
  await assert.rejects(reviewDraft(id, outsider, input), { status: 404 });
  assert.equal(calls, 0, "ownership is checked before spending allowance");
  const first = await reviewDraft(id, owner, input);
  // Distinct known dates make ordering independent of query or clock resolution.
  await db.query("UPDATE ai_reviews SET created_at='2026-01-01' WHERE id=$1", [
    first.id,
  ]);
  const second = await reviewDraft(id, owner, { ...input, type: "clarity" });
  assert.deepEqual(
    (await draftReviews(id, owner)).map((r) => r.id),
    [second.id, first.id],
  );
  assert.deepEqual(await draftReviews(id, outsider), []);
  assert.deepEqual(
    await draftComments(id),
    [],
    "private results never become discussion comments",
  );
  fail = true;
  await assert.rejects(reviewDraft(id, owner, input), { status: 502 });
  assert.equal(
    (await draftReviews(id, owner)).length,
    2,
    "failed reviews do not enter history",
  );
  content.posts[0].text = "Shipping on Friday.";
  await saveDraft(id, owner, content, 1);
  assert.equal(
    (await draftReviews(id, owner))[0].posts[0].text,
    "Shipping on Frday.",
  );
  assert.equal(
    (await draftReviews(id, owner))[0].result.findings[0].replacement,
    "Friday",
  );
  await assert.rejects(deleteDraftReview(id, outsider, second.id), {
    status: 404,
  });
  const otherDraft = randomUUID();
  await createDraft(otherDraft, owner, content);
  await assert.rejects(deleteDraftReview(otherDraft, owner, second.id), {
    status: 404,
  });
  await deleteDraftReview(id, owner, second.id);
  assert.deepEqual(
    (await draftReviews(id, owner)).map((review) => review.id),
    [first.id],
  );
  assert.equal(
    (await db.query("SELECT content FROM drafts WHERE id=$1", [id])).rows[0]
      .content.posts[0].text,
    "Shipping on Friday.",
  );
  await db.query("DELETE FROM drafts WHERE id=$1", [id]);
  assert.deepEqual(await draftReviews(id, owner), []);
});
