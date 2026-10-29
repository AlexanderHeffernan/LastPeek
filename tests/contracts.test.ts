import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
