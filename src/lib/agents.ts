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
    description: "Leave feedback as you on reviews you can access.",
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
