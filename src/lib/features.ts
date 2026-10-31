import { z } from "zod";

// Released capabilities belong to plans. Register future experiments here.
export const featureSchema = z.enum(["x-publishing"] as string[]);
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
