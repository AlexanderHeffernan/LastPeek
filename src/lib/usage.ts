import { z } from "zod";

export const usageQuery = z
  .object({
    userId: z.uuid().optional(),
    period: z.enum(["month", "all"]).default("month"),
  })
  .strict();
export type UsageQuery = z.infer<typeof usageQuery>;
export type APIUsage = {
  provider: "openai" | "x";
  requests: number;
  successful: number;
  failed: number;
  pending: number;
  unpriced: number;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  estimated_usd: number;
  reserved_usd: number;
};
export type UsageData = UsageQuery & {
  account: string | null;
  trackingSince: string;
  providers: APIUsage[];
  legacyXReservedUsd: number;
};
