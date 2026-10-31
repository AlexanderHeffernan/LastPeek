import { randomUUID } from "node:crypto";
import { error } from "@sveltejs/kit";
import { transaction } from "./db";
import {
  usageResolutionSchema,
  creditCheckpointSchema,
  type UsageResolution,
  type CreditCheckpoint,
} from "../usage";

// Raw provider observations stay intact. An exclusion is a billing decision,
// never evidence that X charged zero.
export const usageLedger = `(SELECT u.*,r.decision,r.reconciliation_id,
  CASE WHEN r.decision='non_billable' THEN 0 ELSE COALESCE(r.usd,u.estimated_usd) END AS accounted_usd
  FROM api_usage u LEFT JOIN usage_resolutions r ON r.usage_id=u.id)`;
export const xLedgerTotals = `SELECT COALESCE(sum(COALESCE(r.usd,u.estimated_usd)),0)::text AS usd,
  count(*)::text AS requests,
  count(*) FILTER(WHERE u.estimated_usd IS NULL AND r.usage_id IS NULL)::text AS unresolved,
  count(*) FILTER(WHERE u.outcome='pending' AND r.usage_id IS NULL)::text AS pending,
  count(r.usage_id)::text AS resolutions,
  max(u.completed_at)::text AS completed
  FROM api_usage u LEFT JOIN usage_resolutions r ON r.usage_id=u.id WHERE u.provider='x'`;

export async function reconcileUsage(
  input: UsageResolution,
  actor: string,
  thread?: string,
) {
  const command = usageResolutionSchema.parse(input);
  if (!actor.trim()) error(403, "A reconciliation actor is required.");
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('usage-reconciliation'))",
    );
    const entries = (
      await client.query(
        `SELECT u.id,u.estimated_usd,u.outcome,
       u.created_at > now()-interval '10 minutes' AS recent,r.usage_id AS resolved
       FROM api_usage u LEFT JOIN usage_resolutions r ON r.usage_id=u.id
       WHERE u.id=ANY($1::uuid[]) ORDER BY u.id FOR UPDATE OF u`,
        [command.ids],
      )
    ).rows;
    if (
      entries.length !== command.ids.length ||
      entries.some(
        (row) =>
          row.resolved ||
          row.estimated_usd !== null ||
          (row.outcome === "pending" && row.recent),
      )
    )
      error(
        409,
        "Selection changed or includes priced, reconciled or active requests. Refresh and select again.",
      );
    const id = randomUUID();
    await client.query(
      "INSERT INTO usage_reconciliations(id,actor,reason,evidence,thread) VALUES($1,$2,$3,$4,$5)",
      [id, actor, command.reason, command.evidence, thread ?? null],
    );
    await client.query(
      `INSERT INTO usage_resolutions(usage_id,reconciliation_id,decision,usd)
       SELECT unnest($1::uuid[]),$2,$3,$4::numeric`,
      [command.ids, id, command.decision, command.usd ?? null],
    );
    return { id, requests: entries.length };
  });
}

export async function reconcileXBalance(
  input: CreditCheckpoint,
  actor: string,
  thread?: string,
) {
  const command = creditCheckpointSchema.parse(input);
  if (!actor.trim()) error(403, "A reconciliation actor is required.");
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('usage-reconciliation'))",
    );
    // No external HTTP in this transaction. Stop new usage/completions while
    // checking that the operator's exact fresh snapshot still covers the ledger.
    await client.query("LOCK TABLE api_usage IN SHARE MODE");
    const snapshot = (
      await client.query(
        `SELECT s.*,s.observed_at>now()-interval '10 minutes' AS fresh,c.snapshot_id AS accepted
       FROM x_credit_snapshots s LEFT JOIN x_credit_checkpoints c ON c.snapshot_id=s.id
       ORDER BY s.id DESC LIMIT 1`,
      )
    ).rows[0];
    const totals = (await client.query(xLedgerTotals)).rows[0];
    if (
      !snapshot ||
      snapshot.id !== command.snapshotId ||
      !snapshot.fresh ||
      snapshot.accepted ||
      totals.unresolved !== "0" ||
      snapshot.unresolved !== "0" ||
      totals.pending !== "0" ||
      totals.requests !== snapshot.requests ||
      totals.resolutions !== snapshot.resolutions ||
      Number(totals.usd) !== Number(snapshot.ledger_usd)
    )
      error(
        409,
        "Resolve outstanding calls and wait for a fresh unchanged X balance snapshot, then refresh and review again.",
      );
    const id = randomUUID();
    await client.query(
      "INSERT INTO usage_reconciliations(id,actor,reason,evidence,thread) VALUES($1,$2,$3,$4,$5)",
      [id, actor, command.reason, command.evidence, thread ?? null],
    );
    await client.query(
      "INSERT INTO x_credit_checkpoints(snapshot_id,reconciliation_id) VALUES($1,$2)",
      [command.snapshotId, id],
    );
    return { id, snapshotId: command.snapshotId };
  });
}
