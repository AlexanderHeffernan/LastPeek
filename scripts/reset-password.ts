import { db, transaction } from "../src/lib/server/db";
import { passwordHash } from "../src/lib/server/auth";
import { createInterface } from "node:readline/promises";

// Operate locally over stdin, not an HTTP recovery endpoint or a command-line password.
try {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email)
    throw new Error(
      "Usage: npm run account:reset -- author@example.com < password-file",
    );
  if (process.stdin.isTTY)
    throw new Error(
      "Supply the new password over redirected stdin, not an echoed terminal prompt. See README.",
    );
  const lines = createInterface({ input: process.stdin });
  let password = "";
  for await (const line of lines) {
    password = line;
    break;
  }
  lines.close();
  if (password.length < 12 || password.length > 256)
    throw new Error("Use a password between 12 and 256 characters.");
  const value = await passwordHash(password);
  await transaction(async (client) => {
    const result = await client.query(
      "UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id",
      [value, email],
    );
    if (!result.rowCount)
      throw new Error("Account not found. No changes made.");
    await client.query("DELETE FROM sessions WHERE user_id=$1", [
      result.rows[0].id,
    ]);
  });
  console.log("Password reset; all existing sessions invalidated.");
} finally {
  await db.end();
}
