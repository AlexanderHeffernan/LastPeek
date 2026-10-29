import { remoteOperator } from "../../scripts/operator-client";
import { operatorCommand } from "../../src/lib/operator";
import { featureSchema } from "../../src/lib/features";

export const description =
  "Restricted LastPeek Pi status, safe AI logs and audited account feature grants over Tailscale SSH.";

export default function (amp) {
  const properties = {
    email: { type: "string", description: "Exact account email" },
    feature: { type: "string", enum: featureSchema.options },
    enabled: { type: "boolean" },
    reason: { type: "string", minLength: 1, maxLength: 500 },
    minutes: { type: "integer", minimum: 1, maximum: 60 },
    lines: { type: "integer", minimum: 1, maximum: 200 },
  };
  for (const [name, fields, description] of [
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
        required: [...fields],
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
            message: `${command.enabled ? "Enable" : "Disable"} ${command.feature} for ${command.email}?\nReason: ${command.reason}`,
            requireHuman: true,
          });
          if (!approved || ctx.signal.aborted)
            return "Cancelled; no change sent.";
        }
        return JSON.stringify(await remoteOperator(command));
      },
    });
  }
}
