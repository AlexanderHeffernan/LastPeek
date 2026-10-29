import pg from "pg";
import type { PoolClient } from "pg";
export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
});
export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
