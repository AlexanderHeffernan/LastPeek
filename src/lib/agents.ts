export const agentPermissions = [
  {
    scope: "drafts:read",
    label: "Read my drafts",
    description: "Read your drafts, attachments and feedback.",
  },
  {
    scope: "drafts:write",
    label: "Create and edit drafts",
    description:
      "Create and edit posts and threads, including uploading attachments. Edits update shared reviews.",
  },
  {
    scope: "reviews:read",
    label: "Read shared reviews",
    description: "Read drafts shared with you, their attachments and feedback.",
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
    scope: "sharing:links",
    label: "Manage review links",
    description:
      "Create or remove links anyone can use to review a draft. Creating a link replaces private sharing.",
  },
  {
    scope: "sharing:people",
    label: "Share with people",
    description:
      "See accepted friends and manage their access to drafts. Switching to private sharing removes any review link.",
  },
  {
    scope: "account:read",
    label: "Read my account and allowances",
    description:
      "See your profile, available features, limits and this connection’s recent activity. Never passwords or credentials.",
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
] as const;
// Keep legacy OAuth scopes valid for outstanding credentials, not in new consent.
const legacyAgentScopes = [
  "drafts:share",
  "media:read",
  "media:write",
  "friends:read",
  "friends:write",
  "notifications:read",
  "notifications:write",
] as const;
export type AgentScope =
  | (typeof agentPermissions)[number]["scope"]
  | (typeof legacyAgentScopes)[number];
export const agentScopes = agentPermissions.map(
  (permission) => permission.scope,
);
export const acceptedAgentScopes: readonly AgentScope[] = [
  ...agentScopes,
  ...legacyAgentScopes,
];

export const agentPermissionGroups = [
  {
    label: "Drafting",
    scopes: ["drafts:read", "drafts:write", "account:read"],
  },
  {
    label: "Feedback",
    scopes: ["reviews:read", "feedback:write", "feedback:resolve"],
  },
  { label: "Sharing", scopes: ["sharing:links", "sharing:people"] },
  { label: "AI and X tools", scopes: ["ai:review", "x:read"] },
] as const;

// The old sharing grant already allowed both audiences. Resolve that existing
// authority separately from attachment bundling, which always needs fresh consent.
export function normalizeAgentScopes(
  scopes: readonly AgentScope[],
): AgentScope[] {
  return [
    ...new Set(
      scopes.flatMap<AgentScope>((scope) =>
        scope === "drafts:share"
          ? ["sharing:links", "sharing:people"]
          : [scope],
      ),
    ),
  ];
}

// Bundle attachment access at consent, never by broadening existing tokens.
export function expandAgentScopes(scopes: readonly AgentScope[]): AgentScope[] {
  const normalized = normalizeAgentScopes(scopes);
  return [
    ...new Set<AgentScope>([
      ...normalized,
      ...(normalized.some(
        (scope) => scope === "drafts:read" || scope === "reviews:read",
      )
        ? ["media:read" as const]
        : []),
      ...(normalized.includes("drafts:write") ? ["media:write" as const] : []),
    ]),
  ];
}

export const agentExpiryOptions = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Until disconnected" },
] as const;
