import { z } from "zod";
import type { Feature } from "./features";
import type { APIUsage, UsageData } from "./usage";
import type { Allowances, Plan, PlanUsage } from "./plans";

export const adminView = z.enum([
  "overview",
  "accounts",
  "invitations",
  "features",
  "usage",
  "history",
  "plans",
  "model",
]);
export type AdminView = z.infer<typeof adminView>;

export const financialModelSchema = z
  .object({
    free: z.number().int().min(0).max(100000000).default(100),
    pro: z.number().int().min(0).max(100000000).default(20),
    complimentary: z.number().int().min(0).max(100000000).default(2),
    price: z.number().min(0).max(1000000).default(5),
    currency: z.enum(["USD", "NZD"]).default("USD"),
    fx: z.number().positive().max(1000000).default(1.7),
    tax: z.number().min(0).max(100).default(0),
    fee: z.number().min(0).max(100).default(3),
    fixedFee: z.number().min(0).max(1000000).default(0.3),
    hosting: z.number().min(0).max(1000000000).default(10),
    gbRate: z.number().min(0).max(1000000).default(0.03),
    backups: z.number().int().min(0).max(1000).default(2),
    bandwidth: z.number().min(0).max(1000000).default(0),
    transfer: z.number().min(0).max(1000000).default(2),
    aiUse: z.number().min(0).max(100).default(40),
    xUse: z.number().min(0).max(100).default(40),
    freeStorage: z.number().min(0).max(100).default(25),
    proStorage: z.number().min(0).max(100).default(25),
    freeDrafts: z.number().min(0).max(100).default(30),
    proDrafts: z.number().min(0).max(100).default(30),
    draftKB: z.number().min(0).max(1000000).default(16),
    revisionFactor: z.number().min(1).max(1000000).default(10),
  })
  .strict();
export type FinancialModel = z.infer<typeof financialModelSchema>;
export type AccessChange = {
  id: string;
  kind: "admin" | "feature" | "plan";
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
    last_seen_at: string | null;
    avatar_id: string | null;
    is_admin: boolean;
    drafts: number;
    media_bytes: number;
    role: "owner" | "admin" | "author";
    features: string[];
    usage: APIUsage[];
    entitlement: PlanUsage;
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
  plans: Record<Plan, Allowances>;
  financialModel: FinancialModel;
  invitations: {
    id: string;
    email: string;
    plan: Plan;
    created_at: string;
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
  }[];
};

export const adminFlagsQuery = z
  .object({ userId: z.uuid().optional() })
  .strict();
export type AdminFlags = {
  account: { id: string; name: string; email: string } | null;
  total: number;
  flags: { feature: Feature; active: number; enabled: boolean | null }[];
};
