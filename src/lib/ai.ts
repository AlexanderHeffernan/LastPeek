import { z } from "zod";

export const reviewTypes = {
  quick: {
    label: "Quick review",
    description: "The most useful things to catch before sharing.",
    instruction: "Check typos, clarity, unintended tone and thread flow.",
  },
  proofread: {
    label: "Proofread",
    description: "Spelling, grammar and punctuation. Keep my voice.",
    instruction:
      "Check only spelling, grammar and punctuation. Preserve dialect and intentional informal language.",
  },
  clarity: {
    label: "Clarity",
    description: "Unclear wording, missing context and ambiguity.",
    instruction:
      "Identify unclear wording, ambiguous references and missing context a reader would need. Explain competing readings. Do not add the missing facts yourself.",
  },
  tighten: {
    label: "Tighten",
    description: "Cut repetition without losing the point.",
    instruction:
      "Suggest concise local edits only where repetition or filler obscures the point. Preserve qualifiers and emphasis that carry meaning. Do not shorten for its own sake or rewrite the whole post.",
  },
  tone: {
    label: "Tone",
    description: "How the wording might land with a reader.",
    instruction:
      "Describe plausible reader interpretations grounded in specific wording, especially unintended harshness, condescension or ambiguity. Use conditional language when audience is unknown. Do not infer the author's emotions, moralise, erase humour or impose a formal or corporate voice.",
  },
  flow: {
    label: "Thread flow",
    description: "Order, transitions and repeated points.",
    instruction:
      "Read posts in order. Flag a broken connection, repeated point, unclear reference or missing transition with the relevant post IDs in the explanation. Do not require every post to stand alone or invent connective facts.",
  },
} as const;
export const reviewTypeSchema = z.enum([
  "quick",
  "proofread",
  "clarity",
  "tighten",
  "tone",
  "flow",
]);
export type ReviewType = z.infer<typeof reviewTypeSchema>;

export const reviewInputSchema = z
  .object({
    type: reviewTypeSchema.optional(),
    posts: z
      .array(z.object({ id: z.uuid(), text: z.string().max(20000) }))
      .min(1)
      .max(25),
  })
  .superRefine(({ posts }, ctx) => {
    if (
      new Set(posts.map((p) => p.id)).size !== posts.length ||
      posts.reduce((sum, p) => sum + p.text.length, 0) > 20000 ||
      !posts.some((p) => p.text.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Review requires unique posts and 1–20,000 characters of text.",
      });
    }
  });

export const aiReviewSchema = z.object({
  summary: z.string().max(600),
  findings: z
    .array(
      z.object({
        postId: z.uuid(),
        category: z.enum(["Typo", "Clarity", "Tone", "Thread flow"]),
        feedback: z.string().max(700),
      }),
    )
    .max(5),
});
export type AIReview = z.infer<typeof aiReviewSchema>;

export const aiReviewResultSchema = aiReviewSchema.extend({
  findings: z
    .array(
      aiReviewSchema.shape.findings.element.extend({
        quote: z.string().min(1).max(2000).nullable(),
        replacement: z.string().max(700).nullable(),
      }),
    )
    .max(5),
});
export type AIReviewResult = z.infer<typeof aiReviewResultSchema>;

export type AIReviewRun = {
  id: string;
  type: ReviewType;
  posts: { id: string; text: string }[];
  result: AIReviewResult;
  created_at: string;
};

// Exact, unique anchors only; never apply a stale finding to new wording.
export function applyAIEdit(
  current: string,
  reviewed: string,
  quote: string,
  replacement: string,
) {
  if (
    current !== reviewed ||
    !quote ||
    current.indexOf(quote) < 0 ||
    current.indexOf(quote) !== current.lastIndexOf(quote)
  )
    return null;
  return current.replace(quote, () => replacement);
}
