import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { error, isHttpError } from "@sveltejs/kit";
import { db } from "./db";
import { hash, token } from "./auth";
import { mediaIds } from "../contracts";
import { ownedDraft, sharedDraft, draftMedia } from "./drafts";
import { mediaPath, storeMedia, uploadLimit } from "./media";
import { readBody } from "./request";
import type { AgentScope } from "../agents";

type Agent = { connection_id: string; user_id: string; scopes: AgentScope[] };

export async function createTransfer(
  agent: Agent,
  origin: string,
  input: {
    id: string;
    filename?: string;
    sha256?: string;
    mediaId?: string;
    reviewToken?: string;
  },
) {
  const access = input.mediaId
    ? input.reviewToken
      ? "reviews:read"
      : "drafts:read"
    : "drafts:write";
  if (
    !agent.scopes.includes(access) ||
    !agent.scopes.includes(input.mediaId ? "media:read" : "media:write")
  )
    error(403, "Attachment access follows your draft and review permissions.");
  if (input.reviewToken) {
    if (!agent.scopes.includes("reviews:read"))
      error(403, "Read shared reviews permission is required.");
    const draft = await sharedDraft(input.reviewToken, agent.user_id);
    if (
      draft.id !== input.id ||
      !mediaIds(draft.content).includes(input.mediaId!)
    )
      error(404, "Attachment unavailable.");
  } else await ownedDraft(input.id, agent.user_id);
  const media = input.mediaId
    ? (await draftMedia(input.id)).find((item) => item.id === input.mediaId)
    : null;
  if (input.mediaId && !media) error(404, "Attachment unavailable.");
  const value = token();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await db.query(
    `INSERT INTO agent_transfers(hash,connection_id,draft_id,kind,filename,sha256,media_id,review_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      hash(value),
      agent.connection_id,
      input.id,
      media ? "download" : "upload",
      input.filename ?? null,
      input.sha256 ?? null,
      media?.id ?? null,
      input.reviewToken ? hash(input.reviewToken) : null,
      expiresAt,
    ],
  );
  let image: { type: "image"; mimeType: string; data: string } | undefined;
  if (media?.mime.startsWith("image/")) {
    const bytes = await sharp(await readFile(mediaPath(media.id)), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    image = {
      type: "image",
      mimeType: "image/jpeg",
      data: bytes.toString("base64"),
    };
  }
  return {
    media,
    transfer: {
      url: `${origin}/api/agent-media`,
      method: media ? "GET" : "POST",
      headers: { Authorization: `Bearer ${value}` },
      expiresAt: expiresAt.toISOString(),
      maxBytes: uploadLimit,
    },
    ...(image ? { image } : {}),
  };
}

export async function agentTransfer(
  request: Request,
  kind: "upload" | "download",
) {
  const value = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  if (!value) error(401, "A media transfer authorization is required.");
  const row = (
    await db.query(
      `SELECT t.*,a.user_id,a.scopes FROM agent_transfers t
     JOIN agent_connections a ON a.id=t.connection_id
     JOIN feature_grants g ON g.user_id=a.user_id AND g.feature='agents'
     WHERE t.hash=$1 AND t.kind=$2 AND t.expires_at>now() AND a.revoked_at IS NULL
     AND (a.expires_at IS NULL OR a.expires_at>now())`,
      [hash(value), kind],
    )
  ).rows[0];
  if (
    !row ||
    !row.scopes.includes(kind === "upload" ? "media:write" : "media:read") ||
    !row.scopes.includes(
      kind === "upload"
        ? "drafts:write"
        : row.review_hash
          ? "reviews:read"
          : "drafts:read",
    )
  )
    error(403, "This media transfer is expired or no longer permitted.");
  if (row.review_hash) {
    if (!row.scopes.includes("reviews:read"))
      error(403, "Read shared reviews permission is required.");
    const draft = (
      await db.query(
        "SELECT share_token,friend_token FROM drafts WHERE id=$1",
        [row.draft_id],
      )
    ).rows[0];
    if (!draft) error(404, "Attachment unavailable.");
    const current = draft.share_token ?? draft.friend_token;
    if (!current || hash(current) !== row.review_hash)
      error(404, "Attachment unavailable.");
    const review = await sharedDraft(current, row.user_id);
    if (!mediaIds(review.content).includes(row.media_id))
      error(404, "Attachment unavailable.");
  } else await ownedDraft(row.draft_id, row.user_id);
  return row;
}

export async function uploadTransfer(request: Request) {
  const grant = await agentTransfer(request, "upload");
  const bytes = await readBody(request, uploadLimit);
  if (createHash("sha256").update(bytes).digest("hex") !== grant.sha256)
    error(400, "The upload does not match the authorized SHA-256 digest.");
  if (grant.media_id)
    return (await draftMedia(grant.draft_id)).find(
      (item) => item.id === grant.media_id,
    );
  const claimed = await db.query(
    "UPDATE agent_transfers SET uploading=true WHERE hash=$1 AND NOT uploading AND media_id IS NULL RETURNING hash",
    [grant.hash],
  );
  if (!claimed.rowCount)
    error(
      409,
      "This upload is pending or its outcome is uncertain. Read the draft before starting another upload.",
    );
  try {
    const media = await storeMedia(
      bytes,
      grant.filename,
      grant.draft_id,
      grant.user_id,
    );
    await db.query("UPDATE agent_transfers SET media_id=$2 WHERE hash=$1", [
      grant.hash,
      media.id,
    ]);
    return media;
  } catch (cause) {
    // storeMedia rolls back definite validation/quota failures. Unknown failures
    // retain their claim: the upload may already have committed.
    if (isHttpError(cause) && cause.status < 500)
      await db.query(
        "UPDATE agent_transfers SET uploading=false WHERE hash=$1 AND media_id IS NULL",
        [grant.hash],
      );
    throw cause;
  }
}
