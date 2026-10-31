import twitter from "twitter-text";
import type { Content } from "./contracts";

export function postingProblem(content: Content) {
  if (content.source) return "Reply and quote posting isn’t available yet.";
  if (content.posts.length !== 1) return "Thread posting isn’t available yet.";
  if (content.posts[0].media.length)
    return "Media posting isn’t available yet.";
  if (!twitter.parseTweet(content.posts[0].text).valid)
    return "Use a non-empty text post of up to 280 weighted characters.";
  return "";
}

export type XPublishing = {
  enabled: boolean;
  account: { id: string; username: string; ready: boolean } | null;
  publication: {
    status: string;
    url: string | null;
    text: string;
    version: number;
  } | null;
};
