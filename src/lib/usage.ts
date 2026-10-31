import { z } from "zod";

export const usageQuery = z
  .object({
    userId: z.uuid().optional(),
    period: z.enum(["month", "all"]).default("month"),
  })
  .strict();
export type UsageQuery = z.infer<typeof usageQuery>;
const decisionDetails = {
  reason: z.string().trim().min(5).max(500),
  evidence: z.string().trim().max(1000).default(""),
};
export const usageResolutionSchema = z
  .object({
    action: z.literal("reconcile-usage"),
    ids: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
    decision: z.enum(["confirmed", "non_billable"]),
    usd: z.number().finite().min(0).max(1000).optional(),
    ...decisionDetails,
  })
  .strict()
  .refine(
    (value) =>
      value.decision === "confirmed"
        ? value.usd !== undefined && value.evidence.length >= 5
        : value.usd === undefined,
    {
      message:
        "Confirmed costs need a USD amount and evidence; exclusions must not invent a cost.",
    },
  );
export const creditCheckpointSchema = z
  .object({
    action: z.literal("reconcile-x-balance"),
    snapshotId: z.string().regex(/^[1-9][0-9]*$/),
    ...decisionDetails,
  })
  .strict()
  .refine((value) => value.evidence.length >= 5, {
    message:
      "Record the evidence reviewed before accepting a balance checkpoint.",
  });
export type UsageResolution = z.infer<typeof usageResolutionSchema>;
export type CreditCheckpoint = z.infer<typeof creditCheckpointSchema>;
export type APIUsage = {
  provider: "openai" | "x";
  requests: number;
  successful: number;
  failed: number;
  pending: number;
  unpriced: number;
  excluded: number;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  estimated_usd: number;
  // Complete billable estimate after explicit exclusions, never provider spend for excluded calls.
  cost_usd: number | null;
  reserved_usd: number;
};
export type UsageData = UsageQuery & {
  account: string | null;
  trackingSince: string;
  providers: APIUsage[];
  operations: (APIUsage & { operation: string })[];
  legacyXReservedUsd: number;
  xBalance: {
    id: string;
    state: "baseline" | "matched" | "review";
    observedAt: string;
    prepaidUsd: number;
    freeUsd: number;
    ledgerUsd: number;
    requests: number;
    unresolved: number;
  } | null;
  unresolved: {
    id: string;
    userId: string | null;
    account: string | null;
    operation: string;
    outcome: string;
    createdAt: string;
    resolvable: boolean;
  }[];
  reconciliations: {
    id: string;
    actor: string;
    reason: string;
    evidence: string;
    thread: string | null;
    createdAt: string;
    decision: string;
    requests: number;
    usd: number | null;
    ids: string[];
    snapshotId: string | null;
  }[];
};
