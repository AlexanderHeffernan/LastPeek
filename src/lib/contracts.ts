import { z } from "zod";

export const xPostURLSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(
    /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/[1-9][0-9]{0,19}(?:\/(?:photo|video)\/[1-4])?\/?(?:[?#].*)?$/i,
    "Enter an X post link, such as https://x.com/username/status/123456789.",
  )
  .transform((value) => {
    const path = new URL(value).pathname;
    return `https://x.com${path.replace(/\/(?:photo|video)\/[1-4]\/?$|\/$/gi, "").replace(/\/status\//i, "/status/")}`;
  });

export const postSchema = z.object({
  id: z.uuid(),
  text: z.string().max(25000),
  media: z.array(z.uuid()).max(4),
});
export const authorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  avatar: z.uuid().nullable().optional(),
  handle: z
    .string()
    .regex(
      /^@?[A-Za-z0-9_]{0,15}$/,
      "Use an X handle, up to 15 letters, numbers or underscores.",
    ),
});
export const contentSchema = z
  .object({
    // Keep legacy metadata compatible with stored drafts and the previous app version.
    title: z.string().trim().max(120).default(""),
    author: authorSchema,
    posts: z.array(postSchema).min(1).max(25),
    source: z
      .object({ kind: z.enum(["quote", "reply"]), url: xPostURLSchema })
      .optional(),
  })
  .superRefine((content, ctx) => {
    if (new Set(content.posts.map((p) => p.id)).size !== content.posts.length)
      ctx.addIssue({
        code: "custom",
        message: "Each post needs its own identity.",
      });
    if (content.posts.some((p) => new Set(p.media).size !== p.media.length))
      ctx.addIssue({
        code: "custom",
        message: "An attachment can appear only once on each post.",
      });
  });
export type Content = z.infer<typeof contentSchema>;
export type Post = Content["posts"][number];
export type Media = {
  id: string;
  mime: string;
  bytes: number;
  filename: string;
  width: number | null;
  height: number | null;
};
export type Feedback = {
  id: string;
  revision: number;
  post_id: string | null;
  quote: string | null;
  name: string;
  avatar_id: string | null;
  body: string;
  suggestion: string | null;
  resolved: boolean;
  created_at: string;
};
export function blankContent(
  name: string,
  handle = "",
  avatar: string | null = null,
): Content {
  return {
    title: "",
    author: { name, avatar, handle },
    posts: [{ id: crypto.randomUUID(), text: "", media: [] }],
  };
}
export function hasContent(content: Content) {
  return content.posts.some((p) => p.text.trim() || p.media.length);
}
export function mediaIds(content: Content) {
  return [...new Set(content.posts.flatMap((p) => p.media))];
}
export function mediaURL(id: string, token?: string) {
  return `/media/${id}${token ? `?key=${encodeURIComponent(token)}` : ""}`;
}
export function avatarURL(id: string, token?: string) {
  return `/avatars/${id}${token ? `?key=${encodeURIComponent(token)}` : ""}`;
}
export function relativeTime(value: string | Date) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
