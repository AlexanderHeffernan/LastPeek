import twitter from "twitter-text";
import type { Content } from "./contracts";

export function postingProblem(content: Content) {
  for (const [index, post] of content.posts.entries()) {
    if (
      (!post.text.trim() && !post.media.length) ||
      (post.text.trim() && !twitter.parseTweet(post.text).valid)
    )
      return `Post ${index + 1} needs text of up to 280 weighted characters, or an attachment.`;
  }
  return "";
}

export type XPublishing = {
  enabled: boolean;
  account: {
    id: string;
    username: string;
    ready: boolean;
    mediaReady?: boolean;
  } | null;
  publication: {
    status: string;
    url: string | null;
    text: string;
    version: number;
    completed?: number;
    total?: number;
    phase?: string;
    retryAfter?: number;
    resumable?: boolean;
    message?: string;
  } | null;
};
