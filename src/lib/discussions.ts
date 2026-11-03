import type { Content, Feedback } from "./contracts";

export function unresolvedCount(comments: Feedback[]) {
  const byId = new Map(comments.map((c) => [c.id, c]));
  return comments.filter((comment) => {
    if (comment.deleted_at) return false;
    let current: Feedback | undefined = comment;
    while (current) {
      if (current.resolved) return false;
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return true;
  }).length;
}

export function contextChange(comment: Feedback, content: Content) {
  const post = content.posts.find((p) => p.id === comment.post_id);
  if (comment.post_id && !post) return "Post removed";
  if (comment.media_id && !post?.media.includes(comment.media_id))
    return "Attachment removed";
  if (comment.quote && !post?.text.includes(comment.quote))
    return "Text changed";
  if (
    comment.original_post &&
    !comment.quote &&
    !comment.media_id &&
    comment.original_post.text !== post?.text
  )
    return "Post edited";
  if (
    comment.original_source !== undefined &&
    (comment.original_source?.kind !== content.source?.kind ||
      comment.original_source?.url !== content.source?.url)
  )
    return "Source changed";
  return "";
}
export function mediaTimeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
