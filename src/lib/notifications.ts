export const notificationKinds = [
  {
    id: "friend_request",
    label: "Friend requests",
    message: "You received a friend request.",
  },
  {
    id: "friend_accepted",
    label: "Accepted requests",
    message: "Your friend request was accepted.",
  },
  {
    id: "feedback",
    label: "Feedback",
    message: "You received feedback on a draft.",
  },
  {
    id: "shared_draft",
    label: "Shared drafts",
    message: "A friend shared a draft with you.",
  },
] as const;
export type NotificationKind = (typeof notificationKinds)[number]["id"];
export type NotificationPreferences = Record<NotificationKind, boolean>;
export const defaultNotificationPreferences: NotificationPreferences = {
  friend_request: true,
  friend_accepted: true,
  feedback: true,
  shared_draft: true,
};
export function notificationMessage(kind: NotificationKind) {
  return notificationKinds.find((item) => item.id === kind)!.message;
}
