import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { aiReviewSchema, reviewInputSchema } from "../src/lib/ai";
import { generateStructured } from "../src/lib/server/openai";
import type { AIUsageReport } from "../src/lib/server/usage";

test("AI review bounds the whole thread and strips unrelated private fields", () => {
  const a = { id: randomUUID(), text: "a".repeat(12000) };
  const b = { id: randomUUID(), text: "b".repeat(8000) };
  assert.deepEqual(
    reviewInputSchema.parse({
      posts: [a, b],
      title: "private",
      author: "private",
    }),
    { posts: [a, b] },
  );
  assert.equal(
    reviewInputSchema.safeParse({ posts: [a, { ...b, text: b.text + "c" }] })
      .success,
    false,
  );
  assert.equal(reviewInputSchema.safeParse({ posts: [a, a] }).success, false);
  assert.equal(
    reviewInputSchema.safeParse({ posts: [{ ...a, text: " \n" }] }).success,
    false,
  );
});

test("structured AI requests are bounded, non-stored, validated and fail safely", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  const expected = {
    summary: "Clear overall.",
    findings: [
      {
        postId: randomUUID(),
        category: "Clarity",
        feedback: "Name the subject of ‘it’.",
      },
    ],
  };
  let result: unknown = expected;
  let status = "completed";
  let calls = 0;
  const reports: AIUsageReport[] = [];
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string);
      assert.equal(body.store, false);
      assert.equal(body.service_tier, "default");
      assert.equal(body.max_output_tokens, 4000);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      return new Response(
        JSON.stringify({
          id: "resp_test",
          object: "response",
          status,
          usage: {
            input_tokens: 1000,
            output_tokens: 70,
            input_tokens_details: {
              cached_tokens: 250,
              cache_write_tokens: 100,
            },
          },
          output: [
            {
              type: "message",
              id: "msg_test",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(result),
                  annotations: [],
                },
              ],
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );
  const run = () =>
    generateStructured(
      aiReviewSchema,
      "review",
      "Review only.",
      "untrusted post text",
      async (usage) => {
        reports.push(usage);
      },
    );
  assert.deepEqual(await run(), expected);
  assert.deepEqual(reports[0], {
    outcome: "success",
    inputTokens: 1000,
    cachedInputTokens: 250,
    cacheWriteTokens: 100,
    outputTokens: 70,
    httpStatus: undefined,
  });
  result = {
    summary: "Invalid",
    findings: [{ ...expected.findings[0], category: "Invented" }],
  };
  await assert.rejects(run, { status: 502 });
  result = expected;
  status = "incomplete";
  await assert.rejects(run, { status: 502 });
  assert.equal(reports.at(-1)?.outcome, "incomplete");
  assert.equal(reports.at(-1)?.inputTokens, 1000);
  fetchMock.mock.mockImplementation(async () => {
    calls++;
    return new Response(
      JSON.stringify({ error: { message: "sensitive provider detail" } }),
      { status: 429 },
    );
  });
  const before = calls;
  await assert.rejects(run, {
    status: 502,
    body: {
      status: 502,
      message: "AI review is unavailable right now. Please try again later.",
    },
  });
  assert.equal(
    calls,
    before + 1,
    "failed requests must not automatically retry",
  );
  delete process.env.OPENAI_API_KEY;
  assert.equal(reports.at(-1)?.httpStatus, 429);
  assert.equal(reports.at(-1)?.inputTokens, undefined);
  await assert.rejects(run, { status: 503 });
  assert.equal(calls, before + 1, "disabled AI never contacts OpenAI");
});
