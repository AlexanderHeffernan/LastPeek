import { randomUUID } from "node:crypto";
import { db, transaction } from "../src/lib/server/db";
import { passwordHash } from "../src/lib/server/auth";

try {
  const email = process.env.SEED_EMAIL?.toLowerCase(),
    password = process.env.SEED_PASSWORD;
  if (!email || !password || password.length < 12 || password.length > 256)
    throw new Error(
      "Set SEED_EMAIL and SEED_PASSWORD (at least 12 characters) to bootstrap an administrator.",
    );
  await transaction(async (client) => {
    if (
      (await client.query("SELECT 1 FROM users WHERE email=$1", [email]))
        .rowCount
    ) {
      console.log(
        "Bootstrap account already exists; no password or data changed.",
      );
      return;
    }
    const id = randomUUID();
    await client.query(
      "INSERT INTO users(id,email,name,password_hash,is_admin) VALUES($1,$2,$3,$4,true)",
      [
        id,
        email,
        process.env.SEED_NAME || "Alex",
        await passwordHash(password),
      ],
    );
    const content = {
      title: "A small idea",
      author: { name: process.env.SEED_NAME || "Alex", handle: "alex" },
      posts: [
        {
          id: randomUUID(),
          text: "The best feedback usually starts with a simple question.\n\n“Can you take a quick look at this?”",
          media: [],
        },
        {
          id: randomUUID(),
          text: "That’s why I’m building LastPeek. A little space to get a second pair of eyes before you post.\n\nNo dashboards. No noise. Just your words, a friend, and a better post.",
          media: [],
        },
      ],
    };
    await client.query(
      "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
      [randomUUID(), id, JSON.stringify(content)],
    );
    console.log("Created bootstrap administrator and sample thread.");
  });
} finally {
  await db.end();
}
