import { randomUUID } from "node:crypto";
import { error } from "@sveltejs/kit";
import { z } from "zod";
import twitter from "twitter-text";
import { db, transaction } from "./db";
import { ownedDraft } from "./drafts";
import { hasFeature } from "./features";
import { isPro, reserveAPI } from "./plans";
import { rateLimit } from "./auth";
import { decryptXToken, encryptXToken, xAuthEnabled } from "./x-auth";
import { postingProblem, type XPublishing } from "../x-publishing";

export async function xPublishing(
  userId: string,
  draftId: string,
): Promise<XPublishing> {
  await ownedDraft(draftId, userId);
  const account = (
    await db.query(
      "SELECT x_id,profile,scope,expires_at,refresh_token IS NOT NULL AS refreshable FROM x_accounts WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  const publication = (
    await db.query("SELECT * FROM x_publications WHERE draft_id=$1", [draftId])
  ).rows[0];
  return {
    enabled:
      xAuthEnabled() &&
      (await hasFeature(userId, "x-publishing")) &&
      (await isPro(userId)),
    account: account
      ? {
          id: account.x_id,
          username: account.profile.username,
          ready:
            account.scope.split(" ").includes("tweet.write") &&
            (account.expires_at > new Date() || account.refreshable),
        }
      : null,
    publication: publication
      ? {
          status: publication.status,
          url: publication.post_id
            ? `https://x.com/i/web/status/${publication.post_id}`
            : null,
          text: publication.text,
          version: publication.edit_version,
        }
      : null,
  };
}

export async function postToX(
  userId: string,
  draftId: string,
  version: number,
  xId: string,
) {
  await ownedDraft(draftId, userId);
  if (!xAuthEnabled() || !(await hasFeature(userId, "x-publishing")))
    error(403, "X posting isn’t enabled for this account.");
  await rateLimit(`x-posting:${userId}`, 10, 900);
  await refreshPostingAccess(userId, xId);
  // Serialise the draft claim and allowance reservation. The
  // publication claim commits before POST /tweets; a crash cannot enable retry.
  const claim = await transaction(async (client) => {
    const period = await reserveAPI(client, userId, "x", 0);
    if (!(await hasFeature(userId, "x-publishing")))
      error(403, "X posting isn’t enabled for this account.");
    await client.query(
      "SELECT id FROM drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [draftId, userId],
    );
    const draft = await ownedDraft(draftId, userId, client);
    const previous = (
      await client.query(
        "SELECT status,post_id FROM x_publications WHERE draft_id=$1",
        [draftId],
      )
    ).rows[0];
    if (previous && previous.status !== "failed")
      error(
        409,
        previous.status === "posted"
          ? "This draft has already been posted to X."
          : "X may have received this post. Check X before taking any further action; automatic retry is blocked.",
      );
    if (draft.edit_version !== version)
      error(409, "The draft changed. Reload and confirm the latest text.");
    const problem = postingProblem(draft.content);
    if (problem) error(400, problem);
    const account = (
      await client.query(
        "SELECT * FROM x_accounts WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (
      !account ||
      account.x_id !== xId ||
      !account.scope.split(" ").includes("tweet.write")
    )
      error(409, "Connect the intended X account and allow posting first.");
    const access = await decryptXToken(account.access_token);
    if (account.expires_at <= new Date())
      error(409, "Reconnect X to renew posting access.");
    const text = draft.content.posts[0].text;
    const cost = twitter.extractUrls(text).length ? 0.2 : 0.015;
    await reserveAPI(client, userId, "x", cost);
    const budget = process.env.X_API_MONTHLY_BUDGET_USD ?? "5";
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(budget))
      error(503, "X posting budget isn’t configured.");
    const cents = Math.ceil(cost * 100);
    const reserved = await client.query(
      `INSERT INTO x_api_budgets(month,reserved_cents)
      SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date,$1::int WHERE $1::int<=$2::int
      ON CONFLICT(month) DO UPDATE SET reserved_cents=x_api_budgets.reserved_cents+$1
      WHERE x_api_budgets.reserved_cents+$1<=$2 RETURNING month`,
      [cents, Math.round(Number(budget) * 100)],
    );
    if (!reserved.rowCount)
      error(429, "The site’s X allowance is used. Try after it renews.");
    const usageId = randomUUID();
    await client.query(
      "INSERT INTO api_usage(id,user_id,provider,model,reserved_cents,period_start,reserved_usd) VALUES($1,$2,'x','post-create',$3,$4,$5)",
      [usageId, userId, cents, period, cost],
    );
    await client.query(
      `INSERT INTO x_publications(draft_id,edit_version,x_id,text,status) VALUES($1,$2,$3,$4,'pending')
      ON CONFLICT(draft_id) DO UPDATE SET edit_version=$2,x_id=$3,text=$4,status='pending',post_id=NULL,attempted_at=now(),posted_at=NULL`,
      [draftId, version, xId, text],
    );
    return { access, text, usageId, cost };
  });
  let postId: string | null = null;
  let status: number | null = null;
  try {
    const response = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${claim.access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: claim.text }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    if (response.ok)
      postId = z
        .object({
          data: z.object({ id: z.string().regex(/^[1-9][0-9]{0,19}$/) }),
        })
        .parse(await response.json()).data.id;
  } catch {
    /* Never log provider bodies, draft text or credentials. */
  }
  const failed =
    status !== null && status >= 400 && status < 500 && status !== 408;
  await transaction(async (client) => {
    await client.query(
      "UPDATE x_publications SET status=$2,post_id=$3,posted_at=CASE WHEN $3::text IS NOT NULL THEN now() END WHERE draft_id=$1",
      [draftId, postId ? "posted" : failed ? "failed" : "unknown", postId],
    );
    await client.query(
      "UPDATE api_usage SET outcome=$2,http_status=$3,estimated_usd=$4,completed_at=now() WHERE id=$1",
      [
        claim.usageId,
        postId ? "success" : failed ? "error" : "incomplete",
        status,
        postId ? claim.cost : null,
      ],
    );
  });
  if (!postId)
    error(
      failed ? 502 : 409,
      failed
        ? "X rejected the post. Check your connection, account permissions and X credits before trying again."
        : "X may have received this post. Check X; automatic retry is blocked to avoid a duplicate.",
    );
  return xPublishing(userId, draftId);
}

async function refreshPostingAccess(userId: string, xId: string) {
  // Commit token rotation independently: a later quota/conflict rejection must
  // not roll back a refresh token X has already rotated.
  const renewed = await transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const account = (
      await client.query(
        "SELECT * FROM x_accounts WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (
      !account ||
      account.x_id !== xId ||
      !account.scope.split(" ").includes("tweet.write")
    )
      error(409, "Connect the intended X account and allow posting first.");
    if (account.expires_at.getTime() > Date.now() + 30000) return true;
    if (!account.refresh_token) return false;
    try {
      const response = await fetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: await decryptXToken(account.refresh_token),
        }),
      });
      if (!response.ok) throw new Error();
      const refreshed = z
        .object({
          access_token: z.string().min(1).max(8192),
          refresh_token: z.string().min(1).max(8192),
          expires_in: z.number().positive().max(31536000),
          scope: z.string(),
        })
        .parse(await response.json());
      if (
        !["tweet.write", "tweet.read", "users.read"].every((s) =>
          refreshed.scope.split(" ").includes(s),
        )
      )
        throw new Error();
      await client.query(
        "UPDATE x_accounts SET access_token=$2,refresh_token=$3,expires_at=$4,scope=$5,updated_at=now() WHERE user_id=$1",
        [
          userId,
          await encryptXToken(refreshed.access_token),
          await encryptXToken(refreshed.refresh_token),
          new Date(Date.now() + refreshed.expires_in * 1000),
          refreshed.scope,
        ],
      );
      return true;
    } catch {
      await client.query(
        "UPDATE x_accounts SET refresh_token=NULL,expires_at=now() WHERE user_id=$1",
        [userId],
      );
      return false;
    }
  });
  if (!renewed)
    error(409, "Couldn’t renew X access. Reconnect X before posting.");
}
