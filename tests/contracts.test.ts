import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { operatorCommand } from "../src/lib/operator";
import {
  blankContent,
  contentSchema,
  hasContent,
  mediaIds,
} from "../src/lib/contracts";

test("drafts preserve multiline Unicode text and stable post/media order", () => {
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  const content = blankContent("Alex");
  content.posts[0].text =
    "A thought 👀\n\n日本語 <script>not executable</script>";
  content.posts[0].media = [b, a];
  content.posts.push({
    id: randomUUID(),
    text: "The follow-up",
    media: [c, b],
  });
  assert.deepEqual(contentSchema.parse(content), content);
  assert.deepEqual(mediaIds(content), [b, a, c]);
  assert.ok(hasContent(content));
  assert.equal(hasContent(blankContent("Alex")), false);
  content.posts[0].text = "";
  assert.ok(hasContent(content), "media-only posts are valid");
});

test("reply and quote sources survive validation with canonical X post links", () => {
  for (const kind of ["reply", "quote"] as const) {
    const content = blankContent("Alex");
    content.source = {
      kind,
      url: " https://twitter.com/Interior/status/463440424141459456/photo/1?s=20 ",
    };
    const parsed = contentSchema.parse(content);
    assert.deepEqual(parsed.source, {
      kind,
      url: "https://x.com/Interior/status/463440424141459456",
    });
    assert.deepEqual(contentSchema.parse(parsed), parsed);
    for (const url of [
      "https://x.com/Interior",
      "https://x.com.evil.test/a/status/123",
      "https://evil.test/a/status/123",
      "javascript:alert(1)",
      "https://x.com/a/status/0",
    ]) {
      assert.equal(
        contentSchema.safeParse({ ...content, source: { kind, url } }).success,
        false,
      );
    }
  }
});

test("rejects ambiguous identities, invalid handles and attachment/thread limits", () => {
  const valid = blankContent("Alex");
  valid.author.handle = "@alex_123";
  assert.ok(contentSchema.safeParse(valid).success);
  const cases = [
    { ...valid, posts: [] },
    { ...valid, posts: [valid.posts[0], valid.posts[0]] },
    { ...valid, author: { name: "", handle: "" } },
    { ...valid, author: { name: "Alex", handle: "not a handle" } },
    {
      ...valid,
      posts: [
        { ...valid.posts[0], media: Array.from({ length: 5 }, randomUUID) },
      ],
    },
    {
      ...valid,
      posts: [
        { ...valid.posts[0], media: [valid.posts[0].id, valid.posts[0].id] },
      ],
    },
    {
      ...valid,
      posts: Array.from({ length: 26 }, () => ({
        id: randomUUID(),
        text: "Post",
        media: [],
      })),
    },
  ];
  for (const input of cases)
    assert.equal(contentSchema.safeParse(input).success, false);
  const boundary = {
    ...valid,
    posts: Array.from({ length: 25 }, () => ({
      id: randomUUID(),
      text: "Post",
      media: [],
    })),
  };
  assert.ok(contentSchema.safeParse(boundary).success);
});

test("operator commands accept explicit grants and reject expanded authority", () => {
  const grant = {
    action: "set_feature_access",
    email: "Owner@example.test",
    feature: "ai-review",
    enabled: false,
    reason: "End trial",
  };
  assert.equal(operatorCommand.parse(grant).action, "set_feature_access");
  const { reason, ...withoutReason } = grant;
  assert.deepEqual(operatorCommand.parse({ ...withoutReason, enabled: true }), {
    ...withoutReason,
    email: "owner@example.test",
    enabled: true,
    reason: "",
  });
  assert.equal(operatorCommand.safeParse(withoutReason).success, false);
  assert.equal(
    operatorCommand.parse({ ...grant, feature: "x-source-posts" }).action,
    "set_feature_access",
  );
  for (const input of [
    { ...grant, feature: "unknown" },
    { ...grant, enabled: "false" },
    { ...grant, reason: " " },
    { ...grant, actor: "root" },
    { action: "exec", command: "id" },
    { action: "recent_logs", minutes: 61, lines: 200 },
    { action: "recent_logs", minutes: 60, lines: 201 },
    { action: "recent_logs", minutes: 0, lines: 1 },
    { action: "admin_overview", sql: "SELECT * FROM users" },
    { action: "admin_users", search: "x".repeat(201) },
    { action: "admin_users", page: 0 },
    { action: "admin_users", page: 1.5 },
    { action: "admin_users", page: 100001 },
    { action: "admin_users", includePasswords: true },
    { action: "admin_usage", userId: "not-an-account-id" },
    { action: "admin_usage", period: "day" },
    { action: "admin_usage", email: "author@example.test" },
    { action: "admin_history", limit: 10000 },
  ])
    assert.equal(operatorCommand.safeParse(input).success, false);
  assert.ok(
    operatorCommand.safeParse({
      action: "recent_logs",
      minutes: 60,
      lines: 200,
    }).success,
  );
  assert.deepEqual(operatorCommand.parse({ action: "admin_users" }), {
    action: "admin_users",
    search: "",
    page: 1,
  });
  assert.ok(operatorCommand.safeParse({ action: "admin_overview" }).success);
  assert.deepEqual(operatorCommand.parse({ action: "admin_usage" }), {
    action: "admin_usage",
    period: "month",
  });
  assert.ok(operatorCommand.safeParse({ action: "admin_history" }).success);
});
