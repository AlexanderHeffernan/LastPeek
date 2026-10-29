import { z } from "zod";

export const reviewInputSchema = z
  .object({
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
