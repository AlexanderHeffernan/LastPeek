import { z } from "zod";
import { featureSchema } from "./features";

const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const operatorCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("feature_access"), email }).strict(),
  z
    .object({
      action: z.literal("set_feature_access"),
      email,
      feature: featureSchema,
      enabled: z.boolean(),
      reason: z.string().trim().min(1).max(500),
      thread: z
        .string()
        .regex(/^T-[0-9a-f-]{36}$/)
        .optional(),
    })
    .strict(),
  z.object({ action: z.literal("service_status") }).strict(),
  z
    .object({
      action: z.literal("recent_logs"),
      minutes: z.number().int().min(1).max(60),
      lines: z.number().int().min(1).max(200),
    })
    .strict(),
]);
export type OperatorCommand = z.infer<typeof operatorCommand>;
