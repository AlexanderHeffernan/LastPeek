import { z } from "zod";
import { featureChangeSchema } from "./features";
import { adminUsersQuery, adminFlagsQuery } from "./admin";
import { usageQuery } from "./usage";

const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const operatorCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("admin_overview") }).strict(),
  z.object({ action: z.literal("admin_history") }).strict(),
  z
    .object({ action: z.literal("admin_flags"), ...adminFlagsQuery.shape })
    .strict(),
  z.object({ action: z.literal("admin_usage"), ...usageQuery.shape }).strict(),
  z
    .object({ action: z.literal("admin_users"), ...adminUsersQuery.shape })
    .strict(),
  z.object({ action: z.literal("feature_access"), email }).strict(),
  featureChangeSchema
    .safeExtend({
      action: z.literal("set_feature_access"),
      email,
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
