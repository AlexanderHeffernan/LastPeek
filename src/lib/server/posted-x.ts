import { randomUUID } from "node:crypto";
import { error } from "@sveltejs/kit";
import { z } from "zod";
import { xPostURLSchema } from "../contracts";
import { db, transaction } from "./db";
import { ownedDraft } from "./drafts";
import { isPro, reserveAPI } from "./plans";
import { finishXRead, xPricingBasis, xReadRates } from "./x-usage";

const timelineSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().regex(/^[1-9][0-9]{0,19}$/),
        author_id: z.string(),
        text: z.string().max(30000),
        created_at: z.iso.datetime(),
        note_tweet: z.object({ text: z.string().max(30000) }).optional(),
        entities: z
          .object({
            urls: z
              .array(z.object({ url: z.string(), expanded_url: z.string() }))
              .optional(),
          })
          .optional(),
        attachments: z
          .object({ media_keys: z.array(z.string()).max(4) })
          .optional(),
        referenced_tweets: z
          .array(z.object({ type: z.string(), id: z.string() }))
          .optional(),
      }),
    )
    .max(20)
    .default([]),
});
const normalize = (text: string) =>
  text
    .normalize("NFC")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/gu, " ")
    .trim();
function similarity(a: string, b: string) {
  const grams = (s: string) => {
    const result = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const key = s.slice(i, i + 2);
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const left = grams(a.toLocaleLowerCase()),
    right = grams(b.toLocaleLowerCase());
  let shared = 0;
  for (const [key, count] of left)
    shared += Math.min(count, right.get(key) ?? 0);
  return a.length + b.length > 2 ? (2 * shared) / (a.length + b.length - 2) : 0;
}

/** One explicit mark claims one bounded read. Reloads and duplicate clicks never search. */
export async function markPosted(
  userId: string,
  draftId: string,
  version: number,
) {
  const claim = await transaction(async (client) => {
    const draft = await ownedDraft(draftId, userId, client);
    const updated = await client.query(
      "UPDATE drafts SET posted_at=COALESCE(posted_at,now()) WHERE id=$1 AND owner_id=$2 AND edit_version=$3 RETURNING posted_at",
      [draftId, userId, version],
    );
    if (!updated.rowCount)
      error(409, "This draft changed. Reload before marking it as posted.");
    if (
      (
        await client.query(
          "SELECT 1 FROM x_publications WHERE draft_id=$1 AND status='posted'",
          [draftId],
        )
      ).rowCount
    )
      return null;
    const inserted = await client.query(
      "INSERT INTO posted_x_links(draft_id,edit_version,status)VALUES($1,$2,'searching') ON CONFLICT DO NOTHING RETURNING draft_id",
      [draftId, version],
    );
    return inserted.rowCount
      ? { content: draft.content, postedAt: updated.rows[0].posted_at as Date }
      : null;
  });
  if (!claim) return;
  let url: string | null = null,
    status = "unmatched";
  let usageId: string | null = null,
    httpStatus: number | null = null;
  let raw: unknown;
  let usable = false;
  try {
    const key = process.env.X_API_BEARER_TOKEN?.trim();
    const account = (
      await db.query("SELECT x_id FROM x_accounts WHERE user_id=$1", [userId])
    ).rows[0];
    const budget = process.env.X_API_MONTHLY_BUDGET_USD ?? "5";
    if (
      !key ||
      !account ||
      !(await isPro(userId)) ||
      !/^\d{1,5}(?:\.\d{1,2})?$/.test(budget)
    )
      return;
    usageId = await transaction(async (client) => {
      const period = await reserveAPI(client, userId, "x", 0.1);
      const reserved = await client.query(
        `INSERT INTO x_api_budgets(month,reserved_cents)
        SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date,10 WHERE $1::int>=10
        ON CONFLICT(month) DO UPDATE SET reserved_cents=x_api_budgets.reserved_cents+10
        WHERE x_api_budgets.reserved_cents+10<=$1 RETURNING month`,
        [Math.round(Number(budget) * 100)],
      );
      if (!reserved.rowCount) return null;
      const id = randomUUID();
      await client.query(
        "INSERT INTO api_usage(id,user_id,provider,model,reserved_cents,period_start,reserved_usd,x_unit_usd,x_pricing_basis,x_read_rates)VALUES($1,$2,'x','post-match',10,$3,0.10,0.005,$4,$5)",
        [id, userId, period, xPricingBasis, xReadRates()],
      );
      return id;
    });
    if (!usageId) return;
    const endpoint = new URL(
      `https://api.x.com/2/users/${encodeURIComponent(account.x_id)}/tweets`,
    );
    endpoint.searchParams.set("max_results", "20");
    endpoint.searchParams.set("exclude", "retweets");
    endpoint.searchParams.set(
      "start_time",
      new Date(claim.postedAt.getTime() - 7 * 86400000).toISOString(),
    );
    endpoint.searchParams.set(
      "tweet.fields",
      "author_id,created_at,entities,note_tweet,attachments,referenced_tweets",
    );
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    httpStatus = response.status;
    if (!response.ok) return;
    raw = await response.json();
    const posts = timelineSchema.parse(raw).data;
    usable = true;
    const wanted = normalize(claim.content.posts[0].text);
    const source = claim.content.source;
    const matches = posts
      .filter((post) => {
        const when = new Date(post.created_at).getTime();
        const references = post.referenced_tweets ?? [];
        return (
          post.author_id === account.x_id &&
          when >= claim.postedAt.getTime() - 7 * 86400000 &&
          when <= Date.now() + 60000 &&
          !references.some((ref) => ref.type === "retweeted") &&
          (source
            ? references.some(
                (ref) =>
                  ref.type ===
                    (source.kind === "reply" ? "replied_to" : "quoted") &&
                  ref.id === new URL(source.url).pathname.split("/").at(-1),
              )
            : !references.some(
                (ref) => ref.type === "replied_to" || ref.type === "quoted",
              ))
        );
      })
      .map((post) => {
        let text = post.note_tweet?.text ?? post.text;
        for (const entity of post.entities?.urls ?? []) {
          const mediaLink =
            /^https:\/\/(?:twitter|x)\.com\/[^/]+\/status\/\d+\/(?:photo|video)\//i.test(
              entity.expanded_url,
            );
          text = text.replaceAll(
            entity.url,
            mediaLink ? "" : entity.expanded_url,
          );
        }
        text = normalize(text);
        return {
          post,
          exact: text === wanted,
          score: similarity(wanted, text),
        };
      })
      .filter(
        (match) => wanted.length >= 12 && (match.exact || match.score >= 0.72),
      )
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score);
    const best = matches[0];
    if (best) {
      url = `https://x.com/i/web/status/${best.post.id}`;
      // Text alone cannot establish media identity, thread completeness or ambiguous repeats.
      status =
        best.exact &&
        matches.filter((m) => m.exact).length === 1 &&
        wanted.length >= 40 &&
        claim.content.posts.length === 1 &&
        !claim.content.posts[0].media.length &&
        !best.post.attachments?.media_keys.length
          ? "linked"
          : "candidate";
    }
  } catch {
    // Missing access, exhausted allowances and provider failures leave a usable manual fallback.
  } finally {
    if (usageId)
      await finishXRead(
        usageId,
        "Post",
        raw,
        httpStatus,
        usable ? "success" : httpStatus === 200 ? "unusable" : "error",
      );
    await db.query(
      "UPDATE posted_x_links SET status=$2,url=$3 WHERE draft_id=$1 AND status='searching'",
      [draftId, status, url],
    );
  }
}

export async function linkPostedX(
  userId: string,
  draftId: string,
  choice: unknown,
  url: unknown,
) {
  const draft = await ownedDraft(draftId, userId);
  if (!draft.posted_at) error(409, "Mark this post as posted first.");
  if (choice === "yes") {
    const result = await db.query(
      "UPDATE posted_x_links SET status='linked' WHERE draft_id=$1 AND status='candidate' RETURNING draft_id",
      [draftId],
    );
    if (!result.rowCount)
      error(409, "That suggestion changed. Refresh and try again.");
  } else if (choice === "no") {
    await db.query(
      "UPDATE posted_x_links SET status='unmatched',url=NULL WHERE draft_id=$1 AND status='candidate'",
      [draftId],
    );
  } else if (choice === "url") {
    const parsed = xPostURLSchema.safeParse(url);
    if (!parsed.success) error(400, "Paste a valid X post link.");
    await db.query(
      "INSERT INTO posted_x_links(draft_id,edit_version,status,url)VALUES($1,$2,'linked',$3) ON CONFLICT(draft_id)DO UPDATE SET status='linked',url=EXCLUDED.url",
      [draftId, draft.edit_version, parsed.data],
    );
  } else error(400, "Choose whether this is your post.");
}
