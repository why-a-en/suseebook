import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { impersonationEvents, memberStores, members, organizations, sessions, users } from "@/db/schema";
import { auth } from "./config";
import { isPlatformAdmin } from "./platform-admins";

export { isPlatformAdmin } from "./platform-admins";

// The boundary between better-auth and the rest of the app. Feature code
// imports from here — never from ./config — so swapping the auth library
// stays a change to this file plus tenancy.ts. See ADR-0002 and
// docs/ARCHITECTURE_ROADMAP.md §1.

// The functional role within an Organization. Defined in src/services/types
// so the framework-free side of the codebase owns it, and re-exported here
// because feature code imports everything auth-shaped from this module.
//
// **Two unrelated things are called "admin" in this codebase:**
//
// - AppRole "admin" — a *tenant* role. The reseller's own administrator:
//   manages their staff, sees their reports. Scoped to one Organization
//   like any member, with no power outside it.
// - PLATFORM_ADMIN_USER_IDS — *platform* operators. Us. A platform operator
//   has NO tenant footprint (no `members` row, no Organization) and lives
//   only under `/platform`; `resolveSession()` returns a `SessionUser` XOR a
//   `PlatformUser`, never both. They reach a client's data by impersonating.
//
// A tenant user can never become a platform operator: the allowlist is the
// single source of truth, with no in-app path to it, so a database
// compromise can't grant it either.
export type { AppRole } from "@/services/types";
import type { AppRole } from "@/services/types";

/**
 * A signed-in **tenant** user — a member of an Organization, working in the
 * app. The everyday session shape; `requireUser()` returns this.
 */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  /** The *active* Organization, from the session — not a property of the user. */
  organizationId: string;
  /**
   * The active Store — resolved fresh every call, never trusted from the
   * session cookie (see sessions.active_store_id's comment). Null when this
   * member has no store grant yet, or has 2+ and hasn't chosen — either way
   * the caller must send them to pick one before anything store-scoped.
   */
  storeId: string | null;
  role: AppRole;
  /** Set while a platform admin is acting as this user. */
  impersonatedBy: string | null;
  /** True until they replace a password someone else chose for them. */
  mustChangePassword: boolean;
};

/**
 * A signed-in **platform operator** — us, the people who run SuSeeOS. A
 * platform operator has NO tenant footprint: no `members` row, no
 * Organization, no tenant role. They live only under `/platform`, and reach
 * a client's data by impersonating (audited). The allowlist
 * (PLATFORM_ADMIN_USER_IDS) is the single source of truth, so there is no
 * in-app path to becoming one and a database compromise can't grant it.
 *
 * "Platform admin" and the tenant "Admin" role are two deliberately separate
 * axes — see the note at the top of this file.
 */
export type PlatformUser = {
  id: string;
  name: string;
  email: string;
};

type ResolvedSession =
  | { kind: "platform"; user: PlatformUser }
  | { kind: "tenant"; user: SessionUser }
  | null;

/**
 * The one place the session cookie is turned into "who is this and what are
 * they". A caller is a platform operator XOR a tenant user, never both.
 *
 * The membership is read on each call rather than baked into the session, so
 * a role change or a suspension takes effect on the next request instead of
 * waiting for the session cookie cache to expire (ADR-0002 decision 3). The
 * cookie cache still spares us the session and user lookups; what remains is
 * one indexed query on `members`.
 */
async function resolveSession(): Promise<ResolvedSession> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const impersonatedBy = session.session.impersonatedBy ?? null;

  // A platform operator who is NOT impersonating is a platform session —
  // full stop, no tenant lookup. While impersonating, `session.user` is the
  // *target* tenant user, so that falls through to the tenant path below and
  // resolves as a normal (banner-flagged) tenant session.
  if (isPlatformAdmin(session.user.id) && !impersonatedBy) {
    return {
      kind: "platform",
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
    };
  }

  const organizationId = session.session.activeOrganizationId;
  // No active Organization means the session predates a membership, or the
  // membership was revoked. Either way there is nothing to scope to.
  if (!organizationId) return null;

  const [row] = await db
    .select({
      memberId: members.id,
      role: members.role,
      memberStatus: members.status,
      organizationStatus: organizations.status,
      mustChangePassword: users.mustChangePassword,
      // Folded into this query rather than a second round trip. It's a
      // constant-vs-column join, so it matches at most one row; the value
      // is still re-validated against member_stores below before it's
      // trusted.
      sessionActiveStoreId: sessions.activeStoreId,
    })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .innerJoin(users, eq(users.id, members.userId))
    .leftJoin(sessions, eq(sessions.id, session.session.id))
    .where(
      and(eq(members.userId, session.user.id), eq(members.organizationId, organizationId)),
    )
    .limit(1);

  if (!row) return null;
  // Two independent suspensions, and either one ends the session:
  //   - the Organization, our lever over a client account (ADR-0002 §8);
  //   - this membership, an Admin's lever over their own staff.
  // Membership status is deliberately not users.banned: that is global, and
  // would lock a shared Supplier out of every reseller they work for.
  if (row.organizationStatus !== "active") return null;
  if (row.memberStatus !== "active") return null;

  return {
    kind: "tenant",
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      organizationId,
      storeId: await resolveActiveStoreId(row.memberId, row.sessionActiveStoreId),
      role: row.role as AppRole,
      impersonatedBy,
      mustChangePassword: row.mustChangePassword,
    },
  };
}

/**
 * The signed-in tenant user, or null. Null also for a signed-in platform
 * operator — from the tenant app's point of view they are not "a user".
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const resolved = await resolveSession();
  return resolved?.kind === "tenant" ? resolved.user : null;
}

/**
 * Where a signed-in caller belongs — `/platform` for an operator, `/` for a
 * tenant — or null when nobody is signed in. Used by `/login` to bounce an
 * already-authenticated visitor to the right place.
 */
export async function signedInHome(): Promise<string | null> {
  const resolved = await resolveSession();
  if (!resolved) return null;
  return resolved.kind === "platform" ? "/platform" : "/";
}

/**
 * The active Store, re-derived on every request rather than trusted from
 * the session — `member_stores` is the only source of truth for what this
 * member may work in.
 *
 * One extra query, on `member_stores` — RLS-exempt, alongside `members`
 * (see DATA_MODEL §5): this runs *before* the Organization scope this
 * member resolves to is established, so it cannot depend on it. `stores`
 * itself is never touched here — it IS RLS-scoped, and its name/status
 * aren't needed to pick an id.
 */
async function resolveActiveStoreId(
  memberId: string,
  sessionActiveStoreId: string | null,
): Promise<string | null> {
  const granted = await db
    .select({ storeId: memberStores.storeId })
    .from(memberStores)
    .where(eq(memberStores.memberId, memberId));
  const grantedIds = granted.map((g) => g.storeId);

  if (sessionActiveStoreId && grantedIds.includes(sessionActiveStoreId)) {
    return sessionActiveStoreId;
  }
  // No stashed choice (or a stale one — a grant since revoked): only safe
  // to resolve silently when there is exactly one candidate. 0 or 2+ means
  // the caller has to be sent to pick.
  return grantedIds.length === 1 ? grantedIds[0] : null;
}

/**
 * For tenant Server Components / layouts / actions. A platform operator who
 * reaches a tenant route is bounced to `/platform` — the two surfaces don't
 * overlap.
 */
export async function requireUser(): Promise<SessionUser> {
  const resolved = await resolveSession();
  if (!resolved) redirect("/login");
  if (resolved.kind === "platform") redirect("/platform");
  return resolved.user;
}

/**
 * For the platform console (`/platform`) — screens and actions only we, the
 * operator, may reach. A tenant user who reaches one is bounced to `/`.
 * Gated on the PLATFORM_ADMIN_USER_IDS allowlist via resolveSession(); there
 * is no in-app path to becoming a platform operator.
 */
export async function requirePlatformUser(): Promise<PlatformUser> {
  const resolved = await resolveSession();
  if (!resolved) redirect("/login");
  if (resolved.kind === "tenant") redirect("/");
  return resolved.user;
}

/**
 * For screens and actions only an Organization's own Admin may reach.
 *
 * Hiding a shortcut is not access control — every admin Server Action calls
 * this, not just the page that renders the link.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * Replaces the caller's own password.
 *
 * `revokeOtherSessions` is deliberately on: someone changing their password
 * because they think another person knows it gains nothing if that person's
 * session stays alive. Clearing `must_change_password` is what releases them
 * from the forced-change redirect.
 *
 * Refused while impersonating — a platform admin acting as someone else must
 * not be able to set that person's password and lock them out.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (user.impersonatedBy) {
    return { ok: false, error: "You can't change a password while impersonating." };
  }

  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch {
    return { ok: false, error: "Current password is incorrect." };
  }

  await db
    .update(users)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return { ok: true };
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Signature unchanged from the self-rolled implementation this replaced, so
 * the login form and its action didn't have to move. Passwords still verify
 * through argon2 (config.ts wires hash.ts into better-auth), which is why
 * migrating users were never asked to reset.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
    return { ok: true };
  } catch {
    // Same generic error whether the email doesn't exist or the password is
    // wrong — don't leak which one it was.
    return { ok: false, error: "Invalid email or password." };
  }
}

export async function logout(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
}

/** Every Organization the signed-in user belongs to — backs the switcher. */
export async function listMemberships(userId: string) {
  return db
    .select({
      organizationId: members.organizationId,
      name: organizations.name,
      role: members.role,
      status: organizations.status,
    })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(eq(members.userId, userId));
}

/** Re-stamps the session's active Organization. ADR-0002 decision 4. */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  });
}

/**
 * Re-stamps the session's active Store — the same idea as
 * setActiveOrganization, one level down, but a plain Drizzle write rather
 * than a better-auth API call: no plugin owns the concept of a Store, so
 * there is no `auth.api.setActiveStore` to call. Written straight to
 * `sessions.active_store_id` (see its own comment for why that is safe
 * despite bypassing better-auth's session machinery).
 *
 * The membership+grant check here is for a clean error message — the real
 * guard is resolveActiveStoreId() re-validating on every subsequent
 * request, so a stale or forged value can resolve to no store but never to
 * one this member isn't granted.
 */
export async function setActiveStore(storeId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) throw new Error("No active Organization.");

  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, session.user.id), eq(members.organizationId, organizationId)))
    .limit(1);
  if (!member) throw new Error("Not a member of this Organization.");

  const [grant] = await db
    .select({ id: memberStores.id })
    .from(memberStores)
    .where(and(eq(memberStores.memberId, member.id), eq(memberStores.storeId, storeId)))
    .limit(1);
  if (!grant) throw new Error("You don't have access to that Store.");

  await db
    .update(sessions)
    .set({ activeStoreId: storeId, updatedAt: new Date() })
    .where(eq(sessions.id, session.session.id));
}

// --- Support impersonation ------------------------------------------------
//
// Platform admins can act as a tenant's user to debug their data. Two things
// are added on top of what the admin plugin gives us, both required by
// ADR-0002: an append-only audit row that outlives the impersonated session,
// and a banner (see ImpersonationBanner) so nobody mistakes a client's
// account for their own.


/**
 * Starts acting as `email`'s user. Writes the audit row *after* the session
 * swap succeeds, so a failed impersonation doesn't leave a phantom record.
 */
export async function startImpersonation(email: string): Promise<void> {
  const actor = await requirePlatformUser();

  const [target] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!target) throw new Error(`No user with email ${email}.`);
  if (target.id === actor.id) throw new Error("You are already yourself.");

  await auth.api.impersonateUser({
    body: { userId: target.id },
    headers: await headers(),
  });

  const [membership] = await db
    .select({ organizationId: members.organizationId })
    .from(members)
    .where(eq(members.userId, target.id))
    .orderBy(members.createdAt)
    .limit(1);

  await db.insert(impersonationEvents).values({
    adminUserId: actor.id,
    targetUserId: target.id,
    organizationId: membership?.organizationId ?? null,
  });
}

/**
 * Returns the admin to their own session and closes the audit row.
 *
 * The row is closed before the session swap, because afterwards there is no
 * longer anything on the request identifying who was impersonating whom —
 * `sessions.impersonated_by` disappears with the session.
 */
export async function stopImpersonation(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  const adminUserId = session?.session.impersonatedBy;

  if (session && adminUserId) {
    const [open] = await db
      .select({ id: impersonationEvents.id })
      .from(impersonationEvents)
      .where(
        and(
          eq(impersonationEvents.adminUserId, adminUserId),
          eq(impersonationEvents.targetUserId, session.user.id),
          isNull(impersonationEvents.endedAt),
        ),
      )
      .orderBy(desc(impersonationEvents.startedAt))
      .limit(1);

    if (open) {
      await db
        .update(impersonationEvents)
        .set({ endedAt: new Date() })
        .where(eq(impersonationEvents.id, open.id));
    }
  }

  await auth.api.stopImpersonating({ headers: await headers() });
}

// Display labels. A Record keyed on AppRole, not a ternary: adding a role
// makes this a compile error until the map is extended, rather than silently
// falling through to the wrong label.
const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  support_agent: "Support Agent",
  supplier: "Supplier",
};

export function roleLabel(role: AppRole): string {
  return ROLE_LABELS[role];
}
