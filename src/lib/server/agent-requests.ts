import { createHash } from "node:crypto";
import { error, isHttpError } from "@sveltejs/kit";
import { db } from "./db";

// A claimed but unfinished request is deliberately not automatically retried:
// a process may have stopped after committing the domain write.
export async function agentRequest(
  connection: string,
  operation: string,
  requestId: string | undefined,
  input: unknown,
  work: () => Promise<unknown>,
) {
  if (!requestId) return work();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const claim = await db.query(
    `INSERT INTO agent_requests(connection_id,request_id,operation,fingerprint)
     VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_id`,
    [connection, requestId, operation, fingerprint],
  );
  if (!claim.rowCount) {
    const previous = (
      await db.query(
        "SELECT operation,fingerprint,result FROM agent_requests WHERE connection_id=$1 AND request_id=$2",
        [connection, requestId],
      )
    ).rows[0];
    if (!previous)
      error(
        409,
        "This request record expired. Read the current state before starting another operation.",
      );
    if (
      previous.operation !== operation ||
      previous.fingerprint !== fingerprint
    )
      error(409, "This request ID was already used for a different operation.");
    if (previous.result === null)
      error(
        409,
        "This request is pending or its outcome is uncertain. Read the current state; do not repeat it with a new request ID.",
      );
    return previous.result;
  }
  try {
    const result = await work();
    const draftId =
      operation === "create_draft"
        ? (result as { id: string }).id
        : ((input as { id?: string }).id ?? null);
    await db.query(
      "UPDATE agent_requests SET result=$3,draft_id=$4 WHERE connection_id=$1 AND request_id=$2",
      [connection, requestId, JSON.stringify(result), draftId],
    );
    return result;
  } catch (cause) {
    // Only definite domain rejections release the claim. Unknown failures may
    // have happened after a write, so retain their uncertain outcome.
    if (isHttpError(cause) && cause.status < 500)
      await db.query(
        "DELETE FROM agent_requests WHERE connection_id=$1 AND request_id=$2 AND result IS NULL",
        [connection, requestId],
      );
    throw cause;
  }
}
