import { db } from "$lib/server/db";
export async function GET() {
  try {
    await db.query("SELECT 1");
    return new Response("ok");
  } catch {
    return new Response("unavailable", { status: 503 });
  }
}
