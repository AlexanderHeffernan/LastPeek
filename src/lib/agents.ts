export const agentPermissions = [
  {
    scope: "drafts:read",
    label: "Read my drafts",
    description: "Read your drafts, attachments list and feedback.",
  },
  {
    scope: "drafts:write",
    label: "Create and edit drafts",
    description:
      "Create posts and threads, and change existing drafts. Edits to shared drafts update the review.",
  },
  {
    scope: "reviews:read",
    label: "Read shared reviews",
    description: "Read drafts shared with you and their feedback.",
  },
  {
    scope: "feedback:write",
    label: "Send feedback",
    description:
      "Leave feedback as you on reviews you can access, labelled with this agent’s name.",
  },
  {
    scope: "feedback:resolve",
    label: "Resolve feedback",
    description: "Resolve or reopen feedback on your own drafts.",
  },
  {
    scope: "drafts:share",
    label: "Manage sharing",
    description:
      "Create or remove review links, see accepted friends and share drafts with them. Can change who has access.",
  },
  {
    scope: "account:read",
    label: "Read my account and allowances",
    description:
      "See your profile, available features, limits and this connection’s recent activity. Never passwords or credentials.",
  },
  {
    scope: "media:read",
    label: "Read attachments",
    description:
      "View and download attachments from drafts or reviews you can access.",
  },
  {
    scope: "media:write",
    label: "Upload attachments",
    description:
      "Upload images and videos to your drafts, using your storage allowance. Attaching them also requires draft editing access.",
  },
  {
    scope: "x:read",
    label: "Look up X posts and accounts",
    description:
      "Read reply/quote context and look up handles, using your X allowance. Does not allow posting.",
  },
  {
    scope: "ai:review",
    label: "Request AI feedback",
    description:
      "Send draft text to LastPeek’s AI reviewer, using your AI allowance.",
  },
  {
    scope: "friends:read",
    label: "Read my friends and requests",
    description: "See accepted friends and pending friend requests.",
  },
  {
    scope: "friends:write",
    label: "Manage friends",
    description:
      "Send, accept or remove friend requests and friendships. Removing a friend also removes their private review access.",
  },
  {
    scope: "notifications:read",
    label: "Read notifications",
    description: "See your notification history and unread counts.",
  },
  {
    scope: "notifications:write",
    label: "Manage notifications",
    description:
      "Mark notifications read, remove notification history and change notification preferences. Does not enable device push.",
  },
] as const;
export type AgentScope = (typeof agentPermissions)[number]["scope"];
export const agentScopes = agentPermissions.map(
  (permission) => permission.scope,
);

export const agentExpiryOptions = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Until disconnected" },
] as const;
