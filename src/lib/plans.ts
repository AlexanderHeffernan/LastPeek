import { z } from "zod";

export const planSchema = z.enum(["free", "pro"]);
export type Plan = z.infer<typeof planSchema>;
export const allowanceSchema = z
  .object({
    drafts: z.number().int().min(0).max(10000),
    storage_mb: z.number().int().min(0).max(1048576),
    upload_mb: z.number().int().min(1).max(50),
    ai_usd: z.number().min(0).max(1000),
    x_usd: z.number().min(0).max(1000),
  })
  .strict();
export type Allowances = z.infer<typeof allowanceSchema>;
export type Entitlement = {
  plan: Plan;
  limits: Allowances;
  nextLimits: Allowances;
  start: string;
  end: string;
  downgradeAtEnd: boolean;
};
export type PlanUsage = Entitlement & {
  drafts: number;
  bytes: number;
  ai: number;
  x: number;
};

// Calculate every boundary from the original day, including Jan 31 → Feb 28 → Mar 31.
export function monthlyPeriod(anchor: Date, now: Date) {
  const boundary = (months: number) => {
    const date = new Date(anchor);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(anchor.getUTCDate(), last));
    return date;
  };
  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    anchor.getUTCMonth();
  if (boundary(months) > now) months--;
  return { start: boundary(months), end: boundary(months + 1) };
}
