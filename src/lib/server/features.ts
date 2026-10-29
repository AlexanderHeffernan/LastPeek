import { db, transaction } from "./db";
import { featureSchema, type Feature } from "../features";

export async function hasFeature(userId: string, feature: Feature) {
  const result = await db.query(
    "SELECT 1 FROM feature_grants WHERE user_id=$1 AND feature=$2",
    [userId, featureSchema.parse(feature)],
  );
  return Boolean(result.rowCount);
}

export async function featureAccess(email: string) {
  const user = await db.query<{ id: string; email: string }>(
    "SELECT id,email FROM users WHERE lower(email)=$1",
    [email],
  );
  if (user.rowCount !== 1) throw new Error("Account not found or ambiguous.");
  const id = user.rows[0].id as string;
  const grants = await db.query(
    "SELECT feature FROM feature_grants WHERE user_id=$1",
    [id],
  );
  const history = await db.query<{
    feature: string;
    enabled: boolean;
    actor: string;
    reason: string;
    thread: string | null;
    created_at: Date;
  }>(
    "SELECT feature,enabled,actor,reason,thread,created_at FROM feature_audit WHERE user_id=$1 ORDER BY id DESC LIMIT 20",
    [id],
  );
  return {
    ...user.rows[0],
    features: Object.fromEntries(
      featureSchema.options.map((key) => [
        key,
        grants.rows.some((r) => r.feature === key),
      ]),
    ),
    history: history.rows,
  };
}

export async function setFeatureAccess(
  email: string,
  feature: Feature,
  enabled: boolean,
  actor: string,
  reason: string,
  thread?: string,
) {
  featureSchema.parse(feature);
  if (
    !actor.trim() ||
    actor.length > 200 ||
    !reason.trim() ||
    reason.length > 500
  )
    throw new Error("An operator identity and bounded reason are required.");
  return transaction(async (client) => {
    // Serialize grants for this account, including concurrent enable/disable requests.
    const user = await client.query(
      "SELECT id FROM users WHERE lower(email)=$1 FOR UPDATE",
      [email],
    );
    if (user.rowCount !== 1) throw new Error("Account not found or ambiguous.");
    const id = user.rows[0].id as string;
    const changed = enabled
      ? await client.query(
          "INSERT INTO feature_grants(user_id,feature) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",
          [id, feature],
        )
      : await client.query(
          "DELETE FROM feature_grants WHERE user_id=$1 AND feature=$2 RETURNING user_id",
          [id, feature],
        );
    if (changed.rowCount) {
      await client.query(
        "INSERT INTO feature_audit(user_id,feature,enabled,actor,reason,thread) VALUES($1,$2,$3,$4,$5,$6)",
        [id, feature, enabled, actor, reason, thread || null],
      );
    }
    return { userId: id, feature, enabled, changed: Boolean(changed.rowCount) };
  });
}
