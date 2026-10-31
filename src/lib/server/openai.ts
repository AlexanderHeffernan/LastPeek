import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { error } from "@sveltejs/kit";
import type { AIUsageReport } from "./usage";

export function aiEnabled() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export const aiModel = () => process.env.OPENAI_MODEL || "gpt-6-luna";

/** Shared transport for opt-in, structured AI features. Never log input or provider errors. */
export async function generateStructured<T extends z.ZodType>(
  schema: T,
  name: string,
  instructions: string,
  input: string,
  reportUsage: (usage: AIUsageReport) => Promise<void>,
): Promise<z.infer<T>> {
  if (!aiEnabled()) error(503, "AI review is not configured on this instance.");
  const started = Date.now();
  const model = aiModel();
  let outcome: AIUsageReport["outcome"] = "error";
  let usage:
    | {
        input_tokens: number;
        output_tokens: number;
        input_tokens_details?: {
          cached_tokens: number;
          cache_write_tokens?: number;
        };
      }
    | undefined;
  let httpStatus: number | undefined;
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 45000,
      maxRetries: 0,
    });
    const response = await client.responses.parse({
      model,
      store: false,
      service_tier: "default",
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      instructions,
      input,
      text: { format: zodTextFormat(schema, name) },
    });
    usage = response.usage;
    if (response.status !== "completed" || !response.output_parsed) {
      outcome = "incomplete";
      error(
        502,
        "AI couldn’t complete this review. Try again or ask a friend.",
      );
    }
    const parsed = schema.parse(response.output_parsed);
    outcome = "success";
    return parsed;
  } catch (cause) {
    if (cause instanceof OpenAI.APIError) httpStatus = cause.status;
    return error(
      502,
      "AI review is unavailable right now. Please try again later.",
    );
  } finally {
    await reportUsage({
      outcome,
      inputTokens: usage?.input_tokens,
      cachedInputTokens: usage?.input_tokens_details?.cached_tokens,
      cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens,
      outputTokens: usage?.output_tokens,
      httpStatus,
    });
    console.log(
      JSON.stringify({
        event: "ai_request",
        outcome,
        model,
        latency_ms: Date.now() - started,
        input_tokens: usage?.input_tokens,
        output_tokens: usage?.output_tokens,
        http_status: httpStatus,
      }),
    );
  }
}
