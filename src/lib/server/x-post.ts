import { z } from "zod";
import { xPostURLSchema } from "../contracts";
import type { XSourcePost } from "../x-post";
import { db, transaction } from "./db";
import { hasFeature } from "./features";

const imageURL = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.host === "pbs.twimg.com";
});
const videoURL = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.host === "video.twimg.com";
});
const entities = z.object({
  urls: z
    .array(
      z.object({
        url: z.url().refine((value) => /^https?:\/\//.test(value)),
        display_url: z.string(),
      }),
    )
    .default([]),
});
const responseSchema = z.object({
  data: z.object({
    id: z.string().regex(/^[1-9][0-9]{0,19}$/),
    text: z.string().max(30000),
    author_id: z.string(),
    created_at: z.iso.datetime(),
    possibly_sensitive: z.boolean().optional(),
    edit_history_tweet_ids: z.array(z.string()).optional(),
    entities: entities.optional(),
    note_tweet: z
      .object({ text: z.string().max(30000), entities: entities.optional() })
      .optional(),
    attachments: z
      .object({
        media_keys: z.array(z.string()).max(4).default([]),
        poll_ids: z.array(z.string()).optional(),
      })
      .optional(),
    referenced_tweets: z
      .array(z.object({ type: z.string(), id: z.string() }))
      .optional(),
  }),
  includes: z.object({
    users: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
        profile_image_url: imageURL,
        protected: z.boolean(),
      }),
    ),
    media: z
      .array(
        z.object({
          media_key: z.string(),
          type: z.enum(["photo", "video", "animated_gif"]),
          url: imageURL.optional(),
          preview_image_url: imageURL.optional(),
          alt_text: z.string().optional(),
          variants: z
            .array(
              z.object({
                content_type: z.string(),
                url: z.string(),
                bit_rate: z.number().optional(),
              }),
            )
            .optional(),
        }),
      )
      .default([]),
  }),
});

function sourceCard(raw: unknown, id: string): XSourcePost | null {
  const { data, includes } = responseSchema.parse(raw);
  const author = includes.users.find((user) => user.id === data.author_id);
  // Do not display formats whose required context we do not render yet.
  if (
    !author ||
    author.protected ||
    data.id !== id ||
    data.possibly_sensitive ||
    (data.edit_history_tweet_ids?.length ?? 0) > 1 ||
    data.attachments?.poll_ids?.length ||
    data.referenced_tweets?.some(
      (post) => post.type === "quoted" || post.type === "retweeted",
    )
  )
    return null;
  const media: XSourcePost["media"] = [];
  for (const key of data.attachments?.media_keys ?? []) {
    const item = includes.media.find((entry) => entry.media_key === key);
    if (!item) return null;
    const variant = item.variants
      ?.filter((entry) => entry.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
    const url = item.type === "photo" ? item.url : variant?.url;
    if (!url || (item.type !== "photo" && !videoURL.safeParse(url).success))
      return null;
    media.push({
      type: item.type,
      url,
      preview: item.preview_image_url,
      alt: item.alt_text ?? "",
    });
  }
  const body = data.note_tweet ?? data;
  return {
    id,
    url: `https://x.com/${author.username}/status/${id}`,
    text: body.text,
    createdAt: data.created_at,
    author: {
      name: author.name,
      username: author.username,
      avatar: author.profile_image_url,
    },
    links: (body.entities?.urls ?? []).map((link) => ({
      text: link.url,
      url: link.url,
      label: link.display_url,
    })),
    media,
  };
}

/** Only call after resolving an owned draft or an active review capability. */
export async function sourcePost(
  ownerId: string,
  url?: string,
): Promise<XSourcePost | null> {
  const key = process.env.X_API_BEARER_TOKEN?.trim();
  const parsed = xPostURLSchema.safeParse(url);
  if (!key || !parsed.success) return null;
  // Gate cached reads and paid requests alike, using the author, never the reviewer.
  if (!(await hasFeature(ownerId, "x-source-posts"))) return null;
  const budget = process.env.X_API_MONTHLY_BUDGET_USD ?? "5";
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(budget)) return null;
  const cents = Math.round(Number(budget) * 100);
  if (cents < 5) return null;
  const id = new URL(parsed.data).pathname.split("/").at(-1)!;
  const lookup = await transaction(async (client) => {
    // Claim misses across processes; never hold database locks during HTTP requests.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 11811))",
      [id],
    );
    const cached = (
      await client.query(
        "SELECT content FROM x_source_posts WHERE post_id=$1 AND expires_at>now()",
        [id],
      )
    ).rows[0];
    if (cached) return { content: cached.content as XSourcePost | null };
    // Reserve 5 cents before EVERY attempt: above the announced 3.5-cent maximum
    // for one post + author + four media. Never refund failures or assume deduplication.
    const reserved = await client.query(
      `
      INSERT INTO x_api_budgets(month,reserved_cents)
      SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date,5 WHERE $1::int>=5
      ON CONFLICT(month) DO UPDATE SET reserved_cents=x_api_budgets.reserved_cents+5
      WHERE x_api_budgets.reserved_cents+5<=$1 RETURNING month`,
      [cents],
    );
    if (!reserved.rowCount) return { content: null };
    await client.query(
      `INSERT INTO x_source_posts(post_id,content,expires_at)
       VALUES($1,NULL,now()+interval '5 minutes')
       ON CONFLICT(post_id) DO UPDATE SET content=NULL,expires_at=EXCLUDED.expires_at`,
      [id],
    );
    return { fetch: true };
  });
  if ("content" in lookup) return lookup.content ?? null;
  // The reservation and miss marker have committed before any billable request.
  let card: XSourcePost | null = null;
  try {
    const endpoint = new URL(`https://api.x.com/2/tweets/${id}`);
    endpoint.searchParams.set("expansions", "author_id,attachments.media_keys");
    endpoint.searchParams.set(
      "tweet.fields",
      "created_at,entities,note_tweet,possibly_sensitive,edit_history_tweet_ids,attachments,referenced_tweets",
    );
    endpoint.searchParams.set("user.fields", "profile_image_url,protected");
    endpoint.searchParams.set(
      "media.fields",
      "url,preview_image_url,alt_text,variants",
    );
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (response.ok) card = sourceCard(await response.json(), id);
  } catch {
    // Credentials, provider response bodies and draft/review URLs never enter logs.
  }
  await db.query(
    `
      INSERT INTO x_source_posts(post_id,content,expires_at)
      VALUES($1,$2,now()+($3::int * interval '1 minute'))
      ON CONFLICT(post_id) DO UPDATE SET content=EXCLUDED.content,expires_at=EXCLUDED.expires_at`,
    [id, card ? JSON.stringify(card) : null, card ? 15 : 5],
  );
  return card;
}
