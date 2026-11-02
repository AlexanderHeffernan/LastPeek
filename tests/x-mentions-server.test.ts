import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isHttpError } from "@sveltejs/kit";
import { db } from "../src/lib/server/db";
import { encryptXToken } from "../src/lib/server/x-auth";
import { lookupMentions } from "../src/lib/server/x-mentions";

after(() => db.end());

test("X mentions bound costs, isolate caches and never confuse failures with missing users", async (t) => {
  // Risk: autocomplete spends per keystroke, or an auth failure marks a valid handle invalid.
  const ids = [randomUUID(), randomUUID()];
  process.env.X_API_MONTHLY_BUDGET_USD = "100";
  let calls = 0;
  let status = 200;
  let raw: unknown = {
    data: [{ id: "123", name: "Amp", username: "AmpCode" }],
  };
  t.mock.method(globalThis, "fetch", async (input: URL, init: RequestInit) => {
    calls++;
    assert.equal(input.origin, "https://api.x.com");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.equal(init.body, undefined);
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer test-mentions",
    );
    if (input.pathname.endsWith("search"))
      assert.equal(input.searchParams.get("max_results"), "5");
    // Claims must be durable BEFORE the provider call, including a concurrency miss marker.
    assert.ok(
      (
        await db.query(
          "SELECT 1 FROM api_usage WHERE user_id=ANY($1::uuid[]) AND outcome='pending'",
          [ids],
        )
      ).rowCount,
    );
    return Response.json(raw, { status });
  });
  const search = (userId = ids[0], query = "Amp") =>
    lookupMentions(userId, { kind: "search", query });
  const check = (query: string) =>
    lookupMentions(ids[0], { kind: "check", query });
  const rejects = (code: number) => (e: unknown) =>
    isHttpError(e) && e.status === code;
  try {
    for (const [index, id] of ids.entries()) {
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,plan,pro_limits) SELECT $1,$2,'Mention tester','unused','pro',limits FROM plan_allowances WHERE plan='pro'",
        [id, `${id}@example.test`],
      );
      await db.query(
        "INSERT INTO x_accounts(user_id,x_id,access_token,expires_at,scope,profile) VALUES($1,$2,$3,now()+interval '1 hour','users.read',$4)",
        [
          id,
          `${Date.now()}${index}`,
          await encryptXToken("test-mentions"),
          { id: "1", name: "Tester", username: "tester" },
        ],
      );
    }
    await assert.rejects(search(), rejects(403));
    for (const id of ids)
      await db.query(
        "INSERT INTO feature_grants(user_id,feature) VALUES($1,'x-mentions')",
        [id],
      );
    const simultaneous = await Promise.allSettled([search(), search()]);
    assert.ok(
      simultaneous.some(
        (result) =>
          result.status === "fulfilled" &&
          result.value.accounts[0].username === "AmpCode",
      ),
    );
    for (const result of simultaneous)
      if (result.status === "rejected") assert.ok(rejects(503)(result.reason));
    assert.equal((await search(ids[0], "AMP")).accounts[0].username, "AmpCode");
    assert.equal((await check("ampcode")).missing, false);
    assert.equal(
      calls,
      1,
      "search, case variant and selected handle reuse the same lookup",
    );
    await search(ids[1]);
    assert.equal(calls, 2, "per-author search history is private");
    status = 404;
    raw = {};
    await assert.rejects(check("notanendpoint"), rejects(503));
    for (const code of [403, 429, 500]) {
      status = code;
      raw = {
        errors: [
          {
            type: "https://api.twitter.com/2/problems/resource-not-found",
            parameter: "username",
            value: `failure${code}`,
          },
        ],
      };
      await assert.rejects(check(`failure${code}`), rejects(503));
    }
    for (const code of [200, 404]) {
      status = code;
      raw = {
        errors: [
          {
            type: "https://api.twitter.com/2/problems/resource-not-found",
            parameter: "username",
            value: `missing${code}`,
          },
        ],
      };
      assert.equal((await check(`missing${code}`)).missing, true);
    }
    status = 200;
    raw = {
      errors: [
        {
          resource_type: "user",
          title: "Not Found Error",
          detail: "Could not find user with username: [legacy].",
        },
      ],
    };
    assert.equal((await check("legacy")).missing, true);
    raw = {
      errors: [
        {
          type: "https://api.twitter.com/2/problems/resource-not-found",
          parameter: "username",
          value: "somebodyelse",
        },
      ],
    };
    await assert.rejects(check("wrongresource"), rejects(503));
    const before = calls;
    assert.equal((await check("MISSING200")).missing, true);
    assert.equal(calls, before);
    await db.query("DELETE FROM feature_grants WHERE user_id=$1", [ids[0]]);
    await assert.rejects(check("AmpCode"), rejects(403));
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'x-mentions')",
      [ids[0]],
    );
    await db.query("UPDATE users SET plan='free' WHERE id=$1", [ids[0]]);
    await assert.rejects(check("AmpCode"), rejects(403));
    await db.query("UPDATE users SET plan='pro' WHERE id=$1", [ids[0]]);
    process.env.X_API_MONTHLY_BUDGET_USD = "0";
    await assert.rejects(search(ids[0], "Budget"), rejects(429));
    assert.equal(
      calls,
      before,
      "disabled access and exhausted global cap never call X",
    );
    const ledger = (
      await db.query(
        "SELECT reserved_usd,estimated_usd FROM api_usage WHERE user_id=$1 AND model='mention-search'",
        [ids[0]],
      )
    ).rows;
    assert.equal(ledger.length, 1);
    assert.equal(Number(ledger[0].reserved_usd), 0.05);
    assert.equal(Number(ledger[0].estimated_usd), 0.01);
  } finally {
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  }
});
