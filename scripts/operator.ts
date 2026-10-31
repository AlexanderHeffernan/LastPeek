import { db } from "../src/lib/server/db";
import { featureAccess, setFeatureAccess } from "../src/lib/server/features";
import { operatorCommand } from "../src/lib/operator";
import {
  adminOverview,
  adminUsers,
  adminUsage,
  adminHistory,
  adminFlags,
} from "../src/lib/server/admin";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 4096) throw new Error("Request too large.");
  }
  const command = operatorCommand.parse(JSON.parse(input));
  let result;
  if (command.action === "admin_overview") result = await adminOverview();
  else if (command.action === "admin_history") result = await adminHistory();
  else if (command.action === "admin_flags")
    result = await adminFlags({ userId: command.userId });
  else if (command.action === "admin_usage")
    result = await adminUsage({
      userId: command.userId,
      period: command.period,
    });
  else if (command.action === "admin_users")
    result = await adminUsers({ search: command.search, page: command.page });
  else if (command.action === "feature_access")
    result = await featureAccess(command.email);
  else if (command.action === "set_feature_access") {
    if (process.env.LASTPEEK_OPERATOR_ROLE !== "flags")
      throw new Error("Flag-write role required.");
    const actor = process.env.LASTPEEK_OPERATOR_ACTOR;
    if (!actor) throw new Error("Missing operator identity.");
    result = await setFeatureAccess(
      command.email,
      command.feature,
      command.enabled,
      actor,
      command.reason,
      command.thread,
    );
  } else throw new Error("This command belongs to the host gateway.");
  console.log(JSON.stringify({ ok: true, result }));
} catch (e) {
  // Never serialize database errors: they can contain query parameters.
  const message =
    e instanceof Error &&
    [
      "Account not found or ambiguous.",
      "Flag-write role required.",
      "Missing operator identity.",
      "Owner admin access is not configured.",
    ].includes(e.message)
      ? e.message
      : "Operator request failed. Check command, migration and service availability.";
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
} finally {
  await db.end();
}
