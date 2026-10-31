import { z } from "zod";
import type { Feature } from "./features";
import type { APIUsage, UsageData } from "./usage";

export const adminView = z.enum([
  "overview",
  "accounts",
  "features",
  "usage",
  "history",
]);
export type AdminView = z.infer<typeof adminView>;
export type AccessChange = {
  id: string;
  kind: "admin" | "feature";
  feature: string | null;
  actor: string | null;
  account: string | null;
  enabled: boolean;
  reason: string | null;
  created_at: string;
};

export const adminUsersQuery = z
  .object({
    search: z.string().trim().max(200).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();

export type AdminUsersQuery = z.infer<typeof adminUsersQuery>;

export type AdminOverview = {
  captured_at: string;
  accounts: number;
  new_accounts: number;
  administrators: number;
  pending_invites: number;
  accepted_invites: number;
  drafts: number;
  review_links: number;
  feedback: number;
  media_bytes: number;
  usage: APIUsage[];
  ownerId: string;
  service: { database: "healthy"; revision: string };
  accessHistory: {
    id: string;
    actor: string | null;
    account: string | null;
    enabled: boolean;
    created_at: string;
  }[];
};

export type AdminDirectory = {
  search: string;
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  users: {
    id: string;
    name: string;
    email: string;
    created_at: string;
    avatar_id: string | null;
    is_admin: boolean;
    drafts: number;
    media_bytes: number;
    role: "owner" | "admin" | "author";
    features: string[];
    usage: APIUsage[];
  }[];
};

export type AdminData = {
  view: AdminView;
  invalidQuery: boolean;
  isOwner: boolean;
  overview: AdminOverview | null;
  directory: AdminDirectory | null;
  usage: UsageData | null;
  flags: AdminFlags | null;
  history: AccessChange[];
};

export const adminFlagsQuery = z
  .object({ userId: z.uuid().optional() })
  .strict();
export type AdminFlags = {
  account: { id: string; name: string; email: string } | null;
  total: number;
  flags: { feature: Feature; active: number; enabled: boolean | null }[];
};
