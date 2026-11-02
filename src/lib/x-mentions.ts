import { z } from "zod";

export const mentionAccount = z.object({
  id: z.string().regex(/^\d{1,30}$/),
  name: z.string().max(200),
  username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  profile_image_url: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.host === "pbs.twimg.com";
    })
    .optional(),
});
export const mentionRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("search"),
    query: z.string().regex(/^[A-Za-z0-9_]{3,15}$/),
  }),
  z.object({
    kind: z.literal("check"),
    query: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  }),
]);
export const mentionResult = z.object({
  accounts: z.array(mentionAccount).max(5),
  missing: z.boolean(),
});
export type MentionAccount = z.infer<typeof mentionAccount>;
export type MentionResult = z.infer<typeof mentionResult>;
