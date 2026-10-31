import { z } from "zod";

// Register experiments here. Absence of an account grant always means disabled.
export const featureSchema = z.enum(["ai-review", "x-source-posts"]);
export type Feature = z.infer<typeof featureSchema>;

export const featureChangeSchema = z
  .object({
    feature: featureSchema,
    enabled: z.boolean(),
    reason: z.string().trim().max(500).default(""),
  })
  .refine((change) => change.enabled || Boolean(change.reason), {
    path: ["reason"],
    message: "A reason is required when disabling a feature.",
  });
