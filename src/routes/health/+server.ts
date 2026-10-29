import { db } from "$lib/server/db";
export async function GET() {
  try {
    await db.query("SELECT 1");
    return new Response("ok", {
      headers: {
        "X-LastPeek-Revision": process.env.APP_REVISION || "development",
      },
    });
  } catch {
    return new Response("unavailable", { status: 503 });
  }
}
