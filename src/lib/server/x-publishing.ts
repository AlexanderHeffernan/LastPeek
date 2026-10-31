import { randomUUID } from "node:crypto";
import { error, isHttpError } from "@sveltejs/kit";
import { z } from "zod";
import twitter from "twitter-text";
import { db, transaction } from "./db";
import { ownedDraft, validateContent } from "./drafts";
import { hasFeature } from "./features";
import { isPro, reserveAPI } from "./plans";
import { rateLimit } from "./auth";
import { decryptXToken, encryptXToken, xAuthEnabled } from "./x-auth";
import { postingProblem, type XPublishing } from "../x-publishing";
import { mediaIds } from "../contracts";
import {
  prepareXMedia,
  preparedMime,
  removeXMedia,
  type Upload,
} from "./x-media";

type Progress = {
  posts: { id: string; tweetId?: string; sending?: boolean; media: Upload[] }[];
  message?: string;
};

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
  const progress = publication?.progress as Progress | null;
  const next = progress?.posts.find((p) => !p.tweetId);
  const upload = next?.media.find((m) => m.stage !== "ready");
  const uncertain =
    progress?.posts.some((p) => p.sending) &&
    (!publication.lease_until || publication.lease_until <= new Date());
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
          mediaReady: account.scope.split(" ").includes("media.write"),
        }
      : null,
    publication: publication
      ? {
          status: uncertain ? "unknown" : publication.status,
          url: publication.post_id
            ? `https://x.com/i/web/status/${publication.post_id}`
            : null,
          text: publication.text,
          version: publication.edit_version,
          completed:
            progress?.posts.filter((p) => p.tweetId).length ??
            (publication.post_id ? 1 : 0),
          total: progress?.posts.length ?? 1,
          phase: upload
            ? upload.stage === "prepare"
              ? "Preparing media"
              : upload.stage === "processing"
                ? "Processing media on X"
                : "Uploading media"
            : "Posting",
          retryAfter: Math.max(0, (upload?.checkAt ?? 0) - Date.now()),
          resumable: Boolean(
            progress &&
            !uncertain &&
            !next?.sending &&
            publication.status !== "unknown" &&
            publication.status !== "posted",
          ),
          message: progress?.message,
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
  await rateLimit(`x-posting:${userId}`, 1200, 900);
  await refreshPostingAccess(userId, xId);
  // Each explicit operation advances one bounded step. The browser continues
  // the confirmed job, but no worker or page load ever starts publishing.
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
        "SELECT * FROM x_publications WHERE draft_id=$1 FOR UPDATE",
        [draftId],
      )
    ).rows[0];
    let progress = previous?.progress as Progress | null;
    if (
      previous &&
      (previous.status === "posted" ||
        previous.status === "unknown" ||
        progress?.posts.some((p) => p.sending) ||
        (!progress && previous.status !== "failed"))
    )
      error(
        409,
        previous.status === "posted"
          ? "This draft has already been posted to X."
          : "X may have received this post. Check X before taking any further action; automatic retry is blocked.",
      );
    if (draft.edit_version !== version)
      error(409, "The draft changed. Reload and confirm the latest text.");
    if (previous?.lease_until > new Date())
      error(409, "Publishing is already running. Wait before continuing.");
    const content = await validateContent(draft.content, draftId, client);
    const problem = postingProblem(content);
    if (problem) error(400, problem);
    if (progress && previous.edit_version !== version) {
      if (progress.posts.some((p) => p.tweetId))
        error(
          409,
          "This draft changed after publishing started. The remaining posts cannot be sent from a different revision.",
        );
      progress = null;
    }
    if (progress && previous.x_id !== xId)
      error(409, "Reconnect the same X account to continue this publication.");
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
    if (
      mediaIds(content).length &&
      !account.scope.split(" ").includes("media.write")
    )
      error(409, "Allow media uploads on your X connection before posting.");
    if (!progress) {
      const media = (
        await client.query(
          "SELECT id,mime,bytes::float8 FROM media WHERE draft_id=$1 AND owner_id=$2 AND id=ANY($3::uuid[])",
          [draftId, userId, mediaIds(content)],
        )
      ).rows;
      if (media.length !== mediaIds(content).length)
        error(400, "An attachment is unavailable.");
      progress = {
        posts: content.posts.map((p) => ({
          id: p.id,
          media: p.media.map((id) => ({
            ...media.find((m) => m.id === id),
            stage: "prepare" as const,
          })),
        })),
      };
    }
    const index = progress.posts.findIndex((p) => !p.tweetId);
    const step = progress.posts[index];
    // X IDs expire. Only unfinished posts need fresh uploads; committed posts
    // retain their IDs and are never repeated.
    for (const media of step.media) {
      if (media.expires && media.expires < Date.now() + 60000) {
        media.stage = "prepare";
        delete media.remote;
        delete media.checkAt;
        delete media.expires;
      }
    }
    const upload = step.media.find((m) => m.stage !== "ready");
    if (upload?.checkAt && upload.checkAt > Date.now()) return null;
    const cost = upload
      ? upload.stage === "prepare"
        ? 0
        : 0.05
      : twitter.extractUrls(content.posts[index].text).length ||
          step.media.length ||
          (index === 0 && content.source?.kind === "quote")
        ? 0.2
        : 0.015;
    let usageId: string | null = null;
    if (cost) {
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
      usageId = randomUUID();
      await client.query(
        "INSERT INTO api_usage(id,user_id,provider,model,reserved_cents,period_start,reserved_usd) VALUES($1,$2,'x',$3,$4,$5,$6)",
        [
          usageId,
          userId,
          upload ? "media-upload" : "post-create",
          cents,
          period,
          cost,
        ],
      );
    }
    if (!upload) step.sending = true; // Durable before the non-idempotent POST.
    delete progress.message;
    const lease = randomUUID();
    await client.query(
      `INSERT INTO x_publications(draft_id,edit_version,x_id,text,status,snapshot,progress,lease,lease_until)
      VALUES($1,$2,$3,$4,'pending',$5,$6,$7,now()+interval '120 seconds')
      ON CONFLICT(draft_id) DO UPDATE SET edit_version=$2,x_id=$3,text=$4,status='pending',snapshot=$5,progress=$6,lease=$7,lease_until=now()+interval '120 seconds',attempted_at=now()`,
      [
        draftId,
        version,
        xId,
        content.posts[0].text,
        content,
        JSON.stringify(progress),
        lease,
      ],
    );
    return { access, content, progress, index, upload, lease, usageId, cost };
  });
  if (!claim) return xPublishing(userId, draftId);
  let status: number | null = null;
  let failure = "";
  let uncertain = false;
  const step = claim.progress.posts[claim.index];
  const upload = claim.upload;
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`https://api.x.com/2/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${claim.access}`, ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    status = response.status;
    if (!response.ok) throw new Error("X rejected the request");
    return response;
  };
  try {
    if (upload) {
      if (upload.stage === "prepare") {
        const mime = preparedMime(upload);
        const bytes = await prepareXMedia(upload);
        if (
          bytes.length >
          (mime === "image/gif" ? 15 : mime.startsWith("image/") ? 5 : 50) *
            1024 *
            1024
        )
          error(
            400,
            "This attachment is too large for X. Export a smaller file.",
          );
        upload.preparedMime = mime;
        upload.preparedBytes = bytes.length;
        upload.stage = "initialize";
      } else if (upload.stage === "append") {
        const bytes = await prepareXMedia(upload);
        const start = (upload.segment ?? 0) * 5 * 1024 * 1024;
        const form = new FormData();
        form.set("segment_index", String(upload.segment ?? 0));
        form.set(
          "media",
          new Blob(
            [new Uint8Array(bytes.subarray(start, start + 5 * 1024 * 1024))],
            { type: upload.preparedMime },
          ),
          "media",
        );
        await request(`media/upload/${upload.remote}/append`, {
          method: "POST",
          body: form,
        });
        upload.segment = (upload.segment ?? 0) + 1;
        if (upload.segment * 5 * 1024 * 1024 >= upload.preparedBytes!)
          upload.stage = "finalize";
      } else {
        const response =
          upload.stage === "initialize"
            ? await request("media/upload/initialize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  total_bytes: upload.preparedBytes,
                  media_type: upload.preparedMime,
                  media_category: upload.mime.startsWith("video/")
                    ? "tweet_video"
                    : upload.mime === "image/gif"
                      ? "tweet_gif"
                      : "tweet_image",
                }),
              })
            : upload.stage === "finalize"
              ? await request(`media/upload/${upload.remote}/finalize`, {
                  method: "POST",
                })
              : await request(
                  `media/upload?command=STATUS&media_id=${upload.remote}`,
                );
        const result = z
          .object({
            data: z.object({
              id: z.string().regex(/^\d{1,20}$/),
              expires_after_secs: z.number().positive().max(604800).optional(),
              processing_info: z
                .object({
                  state: z.enum([
                    "pending",
                    "in_progress",
                    "succeeded",
                    "failed",
                  ]),
                  check_after_secs: z
                    .number()
                    .nonnegative()
                    .max(3600)
                    .optional(),
                })
                .optional(),
            }),
          })
          .parse(await response.json()).data;
        upload.remote = result.id;
        if (result.expires_after_secs)
          upload.expires = Date.now() + result.expires_after_secs * 1000;
        if (upload.stage === "initialize") {
          upload.segment = 0;
          upload.expires ??= Date.now() + 3600000;
          upload.stage = "append";
        } else {
          if (result.processing_info?.state === "failed")
            throw new Error("Media processing failed");
          upload.stage =
            !result.processing_info ||
            result.processing_info.state === "succeeded"
              ? "ready"
              : "processing";
          upload.checkAt =
            upload.stage === "processing"
              ? Date.now() +
                Math.max(1, result.processing_info?.check_after_secs ?? 1) *
                  1000
              : undefined;
          if (upload.stage === "ready") await removeXMedia(upload.id);
        }
      }
    } else {
      const sourceId = claim.content.source?.url.match(/\/status\/(\d+)/)?.[1];
      const parent = claim.index
        ? claim.progress.posts[claim.index - 1].tweetId
        : claim.content.source?.kind === "reply"
          ? sourceId
          : undefined;
      const body = {
        ...(claim.content.posts[claim.index].text.trim()
          ? { text: claim.content.posts[claim.index].text }
          : {}),
        ...(step.media.length
          ? { media: { media_ids: step.media.map((m) => m.remote!) } }
          : {}),
        ...(parent ? { reply: { in_reply_to_tweet_id: parent } } : {}),
        ...(!claim.index && claim.content.source?.kind === "quote"
          ? { quote_tweet_id: sourceId }
          : {}),
      };
      const response = await request("tweets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      step.tweetId = z
        .object({
          data: z.object({ id: z.string().regex(/^[1-9][0-9]{0,19}$/) }),
        })
        .parse(await response.json()).data.id;
      step.sending = false;
    }
  } catch (e) {
    // Only an explicit 4xx (not a timeout) proves POST /tweets did not commit.
    uncertain =
      !upload &&
      !(status !== null && status >= 400 && status < 500 && status !== 408);
    step.sending = uncertain;
    failure = isHttpError(e)
      ? e.body.message
      : upload
        ? "Couldn’t upload or process an attachment on X. No text was sent without it. Check X permissions and credits, then continue."
        : uncertain
          ? "X may have received this post. Check X; retry is blocked to avoid a duplicate."
          : claim.content.source?.kind === "quote" && status === 403
            ? "X rejected the quote. Native quote posting requires Enterprise API access."
            : "X rejected the post. Check your connection, account permissions and X credits before continuing.";
    claim.progress.message = failure;
    if (upload) {
      upload.stage = "prepare";
      delete upload.remote;
      delete upload.expires;
      delete upload.checkAt;
    }
  }
  const done = claim.progress.posts.every((p) => p.tweetId);
  await transaction(async (client) => {
    const updated = await client.query(
      "UPDATE x_publications SET status=$2,post_id=$3,progress=$4,lease=NULL,lease_until=NULL,posted_at=CASE WHEN $2='posted' THEN now() ELSE posted_at END WHERE draft_id=$1 AND lease=$5",
      [
        draftId,
        uncertain
          ? "unknown"
          : failure
            ? "failed"
            : done
              ? "posted"
              : "pending",
        claim.progress.posts[0].tweetId ?? null,
        JSON.stringify(claim.progress),
        claim.lease,
      ],
    );
    if (updated.rowCount && done && !failure && !uncertain)
      await client.query("UPDATE drafts SET posted_at=now() WHERE id=$1", [
        draftId,
      ]);
    if (claim.usageId)
      await client.query(
        "UPDATE api_usage SET outcome=$2,http_status=$3,estimated_usd=$4,completed_at=now() WHERE id=$1",
        [
          claim.usageId,
          failure ? (uncertain ? "incomplete" : "error") : "success",
          status,
          !failure &&
          !upload &&
          !step.media.length &&
          !(claim.index === 0 && claim.content.source?.kind === "quote")
            ? claim.cost
            : null,
        ],
      );
  });
  if (failure) error(uncertain ? 409 : 502, failure);
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
