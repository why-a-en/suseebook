import { and, count, desc, eq, gt, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { invitations, members, organizations, users } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/auth/platform-admins";
import { isValidEmailSyntax } from "@/lib/email/address";
import { ServiceError, type AppRole } from "./types";

// Invitations expire in 7 days everywhere they're issued — kept in sync by
// hand with the org plugin's own `invitationExpiresIn` (config.ts) since
// this file writes the row directly rather than through the plugin (see
// createOrganization's own comment for why).
const INVITATION_EXPIRES_IN_MS = 60 * 60 * 24 * 7 * 1000;

// The platform console — provisioning and suspending client Stores. This is
// *us*, the operator, not a tenant Admin, so unlike every other service here
// it doesn't take a `ServiceContext`: there is no Organization to scope to
// (it creates one), and every table it touches — organizations, users,
// accounts, members — is RLS-exempt (see DATA_MODEL §5). It imports `db`
// directly for the same reason `withOrganizationScope` lives in db/client
// rather than in a service.
//
// One `organizations` row IS the Store (ADR-0005 Phase 3 collapsed the
// sub-Store layer this used to also provision) — nothing left for its Admin
// to set up beyond accepting the invite below.

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  memberCount: number;
  createdAt: Date;
};

export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      createdAt: organizations.createdAt,
      memberCount: count(members.id),
    })
    .from(organizations)
    .leftJoin(members, eq(members.organizationId, organizations.id))
    .groupBy(organizations.id)
    .orderBy(desc(organizations.createdAt));

  return rows;
}

export type OrganizationDetail = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: Date;
  members: {
    userId: string;
    name: string;
    email: string;
    role: AppRole;
    status: "active" | "suspended";
    joinedAt: Date;
  }[];
  /** Still-pending, not-yet-expired invitations — almost always just the
   *  first Admin's, until it's accepted. See resendPlatformInvitation /
   *  cancelPlatformInvitation below for why this isn't the same
   *  listPendingInvitations() the tenant Staff screen uses. */
  pendingInvitations: {
    id: string;
    email: string;
    role: AppRole;
    expiresAt: Date;
  }[];
};

/** One Organization, everyone in it, and anyone still waiting to accept.
 *  Null for an unknown id. */
export async function getOrganizationDetail(
  organizationId: string,
): Promise<OrganizationDetail | null> {
  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return null;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: members.role,
      status: members.status,
      joinedAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, organizationId))
    .orderBy(members.createdAt);

  const now = new Date();
  const inviteRows = await db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.organizationId, organizationId), eq(invitations.status, "pending"), gt(invitations.expiresAt, now)))
    .orderBy(desc(invitations.createdAt));

  return {
    ...org,
    members: rows.map((r) => ({ ...r, role: r.role as AppRole })),
    pendingInvitations: inviteRows.map((r) => ({ ...r, role: (r.role ?? "admin") as AppRole })),
  };
}

export type PlatformMetrics = {
  organizations: { total: number; suspended: number };
  users: number;
  members: { active: number; byRole: Record<AppRole, number> };
  newLast7Days: { organizations: number; users: number };
};

/**
 * A glance at the whole platform. Every count is on an RLS-exempt table
 * (organizations / users / members) — no per-tenant fan-out, no owner
 * connection. Cross-tenant order/store volume is deliberately not here: it
 * would need one or the other, and neither is worth it for a headline
 * number yet.
 */
export async function platformMetrics(): Promise<PlatformMetrics> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [orgTotal] = await db.select({ n: count() }).from(organizations);
  const [orgSuspended] = await db
    .select({ n: count() })
    .from(organizations)
    .where(eq(organizations.status, "suspended"));
  const [orgNew] = await db
    .select({ n: count() })
    .from(organizations)
    .where(gte(organizations.createdAt, since));

  const [userTotal] = await db.select({ n: count() }).from(users);
  const [userNew] = await db.select({ n: count() }).from(users).where(gte(users.createdAt, since));

  const [memberTotal] = await db
    .select({ n: count() })
    .from(members)
    .where(eq(members.status, "active"));
  const roleRows = await db
    .select({ role: members.role, n: count() })
    .from(members)
    .where(eq(members.status, "active"))
    .groupBy(members.role);

  const byRole: Record<AppRole, number> = { admin: 0, support_agent: 0, supplier: 0 };
  for (const r of roleRows) {
    if (r.role === "admin" || r.role === "support_agent" || r.role === "supplier") {
      byRole[r.role] = r.n;
    }
  }

  return {
    organizations: { total: orgTotal.n, suspended: orgSuspended.n },
    users: userTotal.n,
    members: { active: memberTotal.n, byRole },
    newLast7Days: { organizations: orgNew.n, users: userNew.n },
  };
}

export type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  /** True for a platform operator — they have no memberships and never touch the tenant app. */
  isOperator: boolean;
  memberships: {
    orgName: string;
    orgSlug: string;
    orgStatus: "active" | "suspended";
    role: AppRole;
    memberStatus: "active" | "suspended";
  }[];
};

/**
 * Every person on the platform, with the Organizations they belong to.
 * No pagination yet — an operator tool at this volume. All from RLS-exempt
 * tables.
 */
export async function listUsers(): Promise<PlatformUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      orgStatus: organizations.status,
      role: members.role,
      memberStatus: members.status,
    })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, members.organizationId))
    .orderBy(desc(users.createdAt));

  const byUser = new Map<string, PlatformUserRow>();
  for (const r of rows) {
    let u = byUser.get(r.id);
    if (!u) {
      u = {
        id: r.id,
        name: r.name,
        email: r.email,
        createdAt: r.createdAt,
        isOperator: isPlatformAdmin(r.id),
        memberships: [],
      };
      byUser.set(r.id, u);
    }
    if (r.orgName && r.orgSlug && r.orgStatus && r.role && r.memberStatus) {
      u.memberships.push({
        orgName: r.orgName,
        orgSlug: r.orgSlug,
        orgStatus: r.orgStatus,
        role: r.role as AppRole,
        memberStatus: r.memberStatus,
      });
    }
  }
  return [...byUser.values()];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type NewOrganization = {
  organizationId: string;
  slug: string;
  adminEmail: string;
  invitationId: string;
};

/**
 * Creates a client Store and invites its first Admin, in one
 * transaction — the in-app equivalent of `pnpm store:create`.
 *
 * The invitation is written directly rather than through the org plugin's
 * `createInvitation` endpoint: that endpoint requires a session with an
 * *active membership* in the target Organization (`orgSessionMiddleware`),
 * and a Platform Admin has no membership anywhere — they aren't a tenant
 * user at all (ADR-0002). Same shape either way: a `pending` row, the
 * invitee sets their own name and password on accept
 * (docs/adr/0005-store-as-sole-tenant.md §5/§6).
 */
export async function createOrganization(input: {
  organizationName: string;
  adminEmail: string;
  invitedById: string;
}): Promise<NewOrganization> {
  const name = input.organizationName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();

  if (!name) throw new ServiceError("Store name is required.");
  if (!isValidEmailSyntax(adminEmail)) throw new ServiceError("Enter a valid Admin email.");

  const slug = slugify(name);
  if (!slug) throw new ServiceError("That name has no letters or digits to slugify.");

  return db.transaction(async (tx) => {
    const [slugTaken] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);
    if (slugTaken) {
      throw new ServiceError(`A Store named something like "${name}" already exists.`);
    }

    const [org] = await tx
      .insert(organizations)
      .values({ name, slug })
      .returning({ id: organizations.id, slug: organizations.slug });

    const [invitation] = await tx
      .insert(invitations)
      .values({
        organizationId: org.id,
        email: adminEmail,
        role: "admin",
        inviterId: input.invitedById,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRES_IN_MS),
      })
      .returning({ id: invitations.id });

    return {
      organizationId: org.id,
      slug: org.slug,
      adminEmail,
      invitationId: invitation.id,
    };
  });
}

export async function setOrganizationStatus(input: {
  organizationId: string;
  status: "active" | "suspended";
}): Promise<void> {
  await db
    .update(organizations)
    .set({ status: input.status })
    .where(eq(organizations.id, input.organizationId));
}

export type ResentInvitation = {
  invitationId: string;
  email: string;
  role: AppRole;
  organizationName: string;
};

/**
 * Resends a still-pending invitation from the operator console — cancels
 * the old row and writes a fresh one (new id/token, new 7-day window), the
 * same shape config.ts's `cancelPendingInvitationsOnReInvite` gives a
 * tenant Admin's resend. Can't reuse auth/index.ts's `inviteToOrganization`
 * for this: it infers *which* Organization from the caller's own active
 * membership (`auth.api.createInvitation`), and a Platform Admin has none —
 * the same reason `createOrganization` above writes its row directly.
 */
export async function resendPlatformInvitation(
  invitationId: string,
  invitedById: string,
): Promise<ResentInvitation> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")))
      .limit(1);
    if (!pending) throw new ServiceError("That invitation is no longer pending.");

    await tx.update(invitations).set({ status: "cancelled" }).where(eq(invitations.id, invitationId));

    const [fresh] = await tx
      .insert(invitations)
      .values({
        organizationId: pending.organizationId,
        email: pending.email,
        role: pending.role,
        inviterId: invitedById,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRES_IN_MS),
      })
      .returning({ id: invitations.id });

    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, pending.organizationId))
      .limit(1);

    return {
      invitationId: fresh.id,
      email: pending.email,
      role: (pending.role ?? "admin") as AppRole,
      organizationName: org?.name ?? "",
    };
  });
}

/** Revokes a still-pending invitation from the operator console. Same
 *  reasoning as resendPlatformInvitation above for why this is a direct
 *  write rather than `auth.api.cancelInvitation`. */
export async function cancelPlatformInvitation(invitationId: string): Promise<void> {
  await db
    .update(invitations)
    .set({ status: "cancelled" })
    .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")));
}
