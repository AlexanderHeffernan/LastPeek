import { remoteOperator } from "../../scripts/operator-client";
import { operatorCommand } from "../../src/lib/operator";
import { featureSchema } from "../../src/lib/features";

export const description =
  "LastPeek site admin overview and accounts, Pi status, safe AI logs and audited account feature grants over restricted Tailscale SSH.";

export default function (amp) {
  const properties = {
    email: { type: "string", description: "Exact account email" },
    userId: {
      type: "string",
      format: "uuid",
      description:
        "Optional account ID from admin_users; omit for all accounts",
    },
    period: {
      type: "string",
      enum: ["month", "all"],
      description: "UTC month (default) or all tracked usage",
    },
    feature: { type: "string", enum: featureSchema.options },
    enabled: { type: "boolean" },
    reason: {
      type: "string",
      maxLength: 500,
      description: "Optional when enabling; required when disabling",
    },
    minutes: { type: "integer", minimum: 1, maximum: 60 },
    lines: { type: "integer", minimum: 1, maximum: 200 },
    search: {
      type: "string",
      maxLength: 200,
      description: "Literal name or email substring; defaults to all accounts",
    },
    page: {
      type: "integer",
      minimum: 1,
      maximum: 100000,
      description: "Page number, 25 accounts per page; defaults to 1",
    },
  };
  for (const [name, fields, description] of [
    [
      "admin_flags",
      ["userId"],
      "Read all registered feature flags, activation counts and optionally one account's enabled/disabled status. Search accounts with admin_users first.",
    ],
    [
      "admin_usage",
      ["userId", "period"],
      "Read global or per-account OpenAI/X request counts, tokens, estimated USD costs and unpriced requests. Estimates are not invoices; no post contents.",
    ],
    [
      "admin_history",
      [],
      "Read the latest 50 admin membership and feature-flag changes, including actors and reasons.",
    ],
    [
      "admin_overview",
      [],
      "Read the same aggregate usage, invitation counts, service revision and admin access history as /siteadmin. No draft text or review tokens.",
    ],
    [
      "admin_users",
      ["search", "page"],
      "Read the same paginated account directory as /siteadmin: identity, role, registration, media storage and feature grants. No sessions, credentials or draft contents.",
    ],
    [
      "feature_access",
      ["email"],
      "Inspect one account's feature grants and recent audit history.",
    ],
    [
      "set_feature_access",
      ["email", "feature", "enabled", "reason"],
      "Enable or disable an account experiment. Requires human confirmation and a flag-write SSH credential. Never deploys.",
    ],
    [
      "service_status",
      [],
      "Read LastPeek container state and health; no configuration or secrets.",
    ],
    [
      "recent_logs",
      ["minutes", "lines"],
      "Read bounded, allowlisted AI request metadata only. No raw logs, draft text or URLs.",
    ],
  ] as const) {
    amp.registerTool({
      name,
      description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          fields.map((field) => [field, properties[field]]),
        ),
        required:
          name === "admin_users" ||
          name === "admin_usage" ||
          name === "admin_flags"
            ? []
            : [...fields].filter((field) => field !== "reason"),
        additionalProperties: false,
      },
      async execute(input, ctx) {
        const command = operatorCommand.parse({
          ...input,
          action: name,
          ...(name === "set_feature_access" ? { thread: ctx.thread.id } : {}),
        });
        if (command.action === "set_feature_access") {
          const approved = await ctx.ui.confirm({
            title: "Change LastPeek feature access",
            message: `${command.enabled ? "Enable" : "Disable"} ${command.feature} for ${command.email}?${command.reason ? `\nReason: ${command.reason}` : ""}`,
            requireHuman: true,
          });
          if (!approved || ctx.signal.aborted)
            return "Cancelled; no change sent.";
        }
        return JSON.stringify(await remoteOperator(command));
      },
    });
  }
  for (const checkpoint of [false, true]) {
    amp.registerTool({
      name: checkpoint ? "reconcile_x_balance" : "reconcile_usage",
      description: checkpoint
        ? "Accept one exact fresh payer-balance snapshot as a new audited baseline after reviewing discrepancies. Requires a write credential and human confirmation; never allocates costs or clears unresolved calls."
        : "Resolve 1–50 exact unresolved usage IDs from admin_usage as evidence-backed USD per request or non-billable exceptions. Preserves original costs, requires reason, write credential and human confirmation. Never bill from reservations or an aggregate wallet delta.",
      inputSchema: {
        type: "object",
        properties: {
          ...(checkpoint
            ? { snapshotId: { type: "string", pattern: "^[1-9][0-9]*$" } }
            : {
                ids: {
                  type: "array",
                  items: { type: "string", format: "uuid" },
                  minItems: 1,
                  maxItems: 50,
                  uniqueItems: true,
                },
                decision: {
                  type: "string",
                  enum: ["confirmed", "non_billable"],
                },
                usd: {
                  type: "number",
                  minimum: 0,
                  maximum: 1000,
                  description:
                    "Verified USD for EACH selected request, not the batch total. Omit for non_billable.",
                },
              }),
          reason: { type: "string", minLength: 5, maxLength: 500 },
          evidence: {
            type: "string",
            maxLength: 1000,
            description:
              "Content-free provider evidence/reference or explanation of the accepted historical gap; required for confirmed costs and balance checkpoints. Never include keys, tokens or draft text.",
          },
        },
        required: checkpoint
          ? ["snapshotId", "reason", "evidence"]
          : ["ids", "decision", "reason"],
        additionalProperties: false,
      },
      async execute(input, ctx) {
        const command = operatorCommand.parse({
          ...input,
          action: checkpoint ? "reconcile-x-balance" : "reconcile-usage",
          thread: ctx.thread.id,
        });
        const details =
          command.action === "reconcile-usage"
            ? `${command.ids.length} requests: ${command.ids.join(", ")}\n${command.decision === "non_billable" ? "Exclude from billing; actual provider costs remain unknown" : `Record USD ${command.usd} for EACH request`}`
            : `Accept X snapshot ${input.snapshotId} as the new baseline; historical discrepancies remain in the audit`;
        const approved = await ctx.ui.confirm({
          title: "Reconcile API accounting",
          message: `${details}\nReason: ${input.reason}\nEvidence: ${input.evidence || "Not available"}`,
          requireHuman: true,
        });
        if (!approved || ctx.signal.aborted)
          return "Cancelled; no change sent.";
        return JSON.stringify(await remoteOperator(command));
      },
    });
  }
}
