import { error } from "@sveltejs/kit";
import { z } from "zod";
import { db, transaction } from "./db";
import type { User } from "./auth";
import {
  adminUsersQuery,
  type AdminUsersQuery,
  type AdminData,
  adminView,
  adminFlagsQuery,
  type AdminFlags,
  type AccessChange,
} from "../admin";
import { featureSchema, type Feature } from "../features";
import { apiUsage, usageByUsers } from "./usage";
import { usageQuery } from "../usage";
import { setFeatureAccess } from "./features";

function ownerId() {
  const parsed = z.uuid().safeParse(process.env.LASTPEEK_OWNER_ID);
  return parsed.success ? parsed.data : null;
}

export function isOwner(user: User | null) {
  return Boolean(user && user.id === ownerId());
}

export function canViewAdmin(user: User | null) {
  return Boolean(ownerId() && user && (isOwner(user) || user.is_admin));
}

export function requireAdmin(user: User | null) {
  if (!canViewAdmin(user)) error(404, "Not found.");
}

export function requireOwner(user: User | null) {
  requireAdmin(user);
  if (!isOwner(user)) error(403, "Only the owner can change site access.");
}

export async function adminData(
  user: User | null,
  params: URLSearchParams,
  section?: string,
): Promise<AdminData> {
  requireAdmin(user);
  const view = adminView.safeParse(
    section ||
      params.get("view") ||
      (params.has("search") ? "accounts" : "overview"),
  );
  const usage = usageQuery.safeParse({
    userId: params.get("userId") || undefined,
    period: params.get("period") || "month",
  });
  const query = adminUsersQuery.safeParse({
    search: params.get("search") || "",
    page: params.get("page") || 1,
  });
  if (!query.success || !usage.success || !view.success)
    return {
      view: view.success ? view.data : "overview",
      invalidQuery: true,
      isOwner: isOwner(user),
      overview: null,
      directory: null,
      usage: null,
      flags: null,
      history: [],
    };
  const [overview, directory, costs, history, flags] = await Promise.all([
    adminOverview(),
    adminUsers(query.data),
    apiUsage(usage.data),
    adminHistory(),
    adminFlags({
      userId: view.data === "features" ? usage.data.userId : undefined,
    }),
  ]);
  return {
    view: view.data,
    invalidQuery: false,
    isOwner: isOwner(user),
    overview,
    directory,
    usage: costs,
    flags,
    history,
  };
}

async function configuredOwner() {
  const id = ownerId();
  if (
    !id ||
    !(await db.query("SELECT 1 FROM users WHERE id=$1", [id])).rowCount
  )
    throw new Error("Owner admin access is not configured.");
  return id;
}

export async function adminOverview() {
  const owner = await configuredOwner();
  const result = await db.query<{
    captured_at: Date;
    accounts: number;
    new_accounts: number;
    administrators: number;
    pending_invites: number;
    accepted_invites: number;
    drafts: number;
    review_links: number;
    feedback: number;
    media_bytes: number;
  }>(
    `SELECT now() AS captured_at,
    (SELECT count(*)::float8 FROM users) AS accounts,
    (SELECT count(*)::float8 FROM users WHERE created_at >= now() - interval '7 days') AS new_accounts,
    (SELECT count(*)::float8 FROM users WHERE is_admin OR id=$1) AS administrators,
    (SELECT count(*)::float8 FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS pending_invites,
    (SELECT count(*)::float8 FROM invites WHERE used_at IS NOT NULL) AS accepted_invites,
    (SELECT count(*)::float8 FROM drafts) AS drafts,
    (SELECT count(*)::float8 FROM drafts WHERE share_token IS NOT NULL) AS review_links,
    (SELECT count(*)::float8 FROM comments) AS feedback,
    ((SELECT COALESCE(sum(bytes),0) FROM media) + (SELECT COALESCE(sum(bytes),0) FROM avatars))::float8 AS media_bytes`,
    [owner],
  );
  const history = await db.query<{
    id: string;
    actor: string | null;
    account: string | null;
    enabled: boolean;
    created_at: Date;
  }>(`SELECT a.id::text, actor.email AS actor, target.email AS account, a.enabled, a.created_at
      FROM admin_access_audit a
      LEFT JOIN users actor ON actor.id=a.actor_id
      LEFT JOIN users target ON target.id=a.user_id
      ORDER BY a.id DESC LIMIT 20`);
  return {
    ...result.rows[0],
    captured_at: result.rows[0].captured_at.toISOString(),
    usage: (await apiUsage({ period: "month" })).providers,
    ownerId: owner,
    service: {
      database: "healthy" as const,
      revision: process.env.APP_REVISION || "development",
    },
    accessHistory: history.rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    })),
  };
}

export async function adminUsers(input: AdminUsersQuery) {
  const owner = await configuredOwner();
  const query = adminUsersQuery.parse(input);
  // Literal substring search: %, _ and backslashes are not user-supplied SQL patterns.
  const search = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
  const total = Number(
    (
      await db.query(
        "SELECT count(*) FROM users WHERE name ILIKE $1 OR email ILIKE $1",
        [search],
      )
    ).rows[0].count,
  );
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pages);
  const result = await db.query<{
    id: string;
    name: string;
    email: string;
    created_at: Date;
    avatar_id: string | null;
    is_admin: boolean;
    drafts: number;
    media_bytes: number;
    features: string[];
  }>(
    `SELECT u.id,u.name,u.email,u.created_at,u.avatar_id,u.is_admin,
      (SELECT count(*)::float8 FROM drafts WHERE owner_id=u.id) AS drafts,
      ((SELECT COALESCE(sum(bytes),0) FROM media WHERE owner_id=u.id)
       + (SELECT COALESCE(sum(bytes),0) FROM avatars WHERE owner_id=u.id))::float8 AS media_bytes,
      ARRAY(SELECT feature FROM feature_grants WHERE user_id=u.id ORDER BY feature) AS features
      FROM users u WHERE name ILIKE $1 OR email ILIKE $1
      ORDER BY u.created_at DESC,u.id LIMIT $2 OFFSET $3`,
    [search, pageSize, (page - 1) * pageSize],
  );
  const usage = await usageByUsers(result.rows.map((row) => row.id));
  return {
    search: query.search,
    page,
    pageSize,
    pages,
    total,
    users: result.rows.map((row) => ({
      ...row,
      usage: usage.get(row.id)!,
      created_at: row.created_at.toISOString(),
      role:
        row.id === owner
          ? ("owner" as const)
          : row.is_admin
            ? ("admin" as const)
            : ("author" as const),
      features: row.features.filter((feature) =>
        featureSchema.options.includes(
          feature as (typeof featureSchema.options)[number],
        ),
      ),
    })),
  };
}

export async function setAdminAccess(
  actor: User,
  userId: string,
  enabled: boolean,
) {
  requireOwner(actor);
  if (userId === ownerId())
    error(400, "The owner’s access cannot be changed here.");
  return transaction(async (client) => {
    const result = await client.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM users WHERE id=$1 FOR UPDATE",
      [userId],
    );
    if (!result.rowCount) error(404, "Account not found.");
    if (result.rows[0].is_admin === enabled) return;
    await client.query("UPDATE users SET is_admin=$1 WHERE id=$2", [
      enabled,
      userId,
    ]);
    await client.query(
      "INSERT INTO admin_access_audit(actor_id,user_id,enabled) VALUES($1,$2,$3)",
      [actor.id, userId, enabled],
    );
  });
}

export async function setAccountFeature(
  actor: User,
  userId: string | null,
  feature: Feature,
  enabled: boolean,
  reason: string,
) {
  requireOwner(actor);
  const account = userId
    ? await db.query("SELECT email FROM users WHERE id=$1", [userId])
    : null;
  if (account && !account.rowCount) error(404, "Account not found.");
  return setFeatureAccess(
    account?.rows[0].email ?? null,
    feature,
    enabled,
    `user:${actor.id}`,
    reason,
  );
}

export async function adminHistory(): Promise<AccessChange[]> {
  await configuredOwner();
  const rows = await db.query(`SELECT * FROM (
    SELECT 'admin:'||a.id AS id,'admin' AS kind,NULL::text AS feature,actor.email AS actor,target.email AS account,a.enabled,NULL::text AS reason,a.created_at
    FROM admin_access_audit a LEFT JOIN users actor ON actor.id=a.actor_id LEFT JOIN users target ON target.id=a.user_id
    UNION ALL
    SELECT 'feature:'||a.id,'feature',a.feature,COALESCE(actor.email,a.actor),target.email,a.enabled,a.reason,a.created_at
    FROM feature_audit a LEFT JOIN users actor ON a.actor='user:'||actor.id LEFT JOIN users target ON target.id=a.user_id
  ) changes ORDER BY created_at DESC,id DESC LIMIT 50`);
  return rows.rows.map((row) => ({
    ...row,
    created_at: row.created_at.toISOString(),
  }));
}

export async function adminUsage(input: Parameters<typeof apiUsage>[0]) {
  await configuredOwner();
  return apiUsage(input);
}

export async function adminFlags(
  input: z.input<typeof adminFlagsQuery>,
): Promise<AdminFlags> {
  await configuredOwner();
  const { userId } = adminFlagsQuery.parse(input);
  const account = userId
    ? await db.query("SELECT id,name,email FROM users WHERE id=$1", [userId])
    : null;
  if (account && !account.rowCount) error(404, "Account not found.");
  const result = await db.query<{
    feature: Feature;
    active: number;
    enabled: boolean | null;
    total: number;
  }>(
    `SELECT f.feature,count(g.user_id)::float8 AS active,
      CASE WHEN $2::uuid IS NULL THEN NULL ELSE COALESCE(bool_or(g.user_id=$2),false) END AS enabled,
      (SELECT count(*)::float8 FROM users) AS total
    FROM unnest($1::text[]) f(feature) LEFT JOIN feature_grants g ON g.feature=f.feature
    GROUP BY f.feature ORDER BY f.feature`,
    [featureSchema.options, userId ?? null],
  );
  return {
    account: account?.rows[0] ?? null,
    total: result.rows[0]?.total ?? 0,
    flags: result.rows.map(({ total, ...flag }) => flag),
  };
}
