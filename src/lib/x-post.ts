export const X_SOURCE_UNAVAILABLE =
  "Quotes and replies aren’t available right now.";

export type XSourcePost = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  author: { name: string; username: string; avatar: string };
  links: { text: string; url: string; label: string }[];
  media: {
    type: "photo" | "video" | "animated_gif";
    url: string;
    preview?: string;
    alt: string;
  }[];
};
