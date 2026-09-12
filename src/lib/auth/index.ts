import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, withOrganizationScope } from "@/db/client";
import { accounts, impersonationEvents, invitations, members, organizations, users } from "@/db/schema";
import { auth } from "./config";
import { hashPassword } from "./hash";
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
  /** The *active* Organization, from the session — not a property of the
   *  user. Also the active Store — ADR-0005 Phase 3 collapsed the two. */
  organizationId: string;
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
      role: members.role,
      memberStatus: members.status,
      organizationStatus: organizations.status,
      mustChangePassword: users.mustChangePassword,
    })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .innerJoin(users, eq(users.id, members.userId))
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

// --- Invitations ------------------------------------------------------------
//
// Joining an Organization is by invitation only (ADR-0005 §6). better-auth's
// organization plugin owns the `invitations` row and the send (config.ts's
// `sendInvitationEmail`); everything here is the part the plugin can't do
// for us — inviting from the caller's *active* Organization, and accepting
// before or after the invitee has an account.

/** Resolves the request's headers, or uses the ones a caller already has —
 *  next/headers' own `headers()` throws outside a request scope, which is
 *  exactly where a test calling these functions directly runs, so every
 *  wrapper below takes an optional override instead of calling it blind. */
async function resolveHeaders(override?: Headers): Promise<Headers> {
  return override ?? (await headers());
}

/** Sends (or re-sends) an invitation from the caller's active Organization.
 *  requireAdmin() at the call site is the real gate; the plugin's own
 *  permission check (config.ts's orgAdminRole/orgStaffRole) is defence in
 *  depth, not the primary guard. */
export async function inviteToOrganization(
  input: { email: string; role: AppRole },
  reqHeaders?: Headers,
): Promise<{ invitationId: string }> {
  const result = await auth.api.createInvitation({
    body: { email: input.email, role: input.role, resend: true },
    headers: await resolveHeaders(reqHeaders),
  });
  return { invitationId: result.id };
}

export type InvitationPreview = {
  id: string;
  email: string;
  role: AppRole;
  organizationName: string;
  inviterName: string;
  /** False once accepted/cancelled/rejected, or past expiresAt. accept()
   *  re-checks this itself — this is only for what the accept screen shows. */
  valid: boolean;
  /** Whether `email` already has an account on the platform — decides
   *  whether the accept screen offers "set your password" (signUpEmail
   *  would fail outright on a taken email) or "sign in to accept". */
  hasAccount: boolean;
};

/** The raw signed-in identity, independent of getCurrentUser()'s
 *  Organization-membership resolution — `/invite/accept` needs to know
 *  *who*, if anyone, is asking before any of that applies (a brand-new
 *  invitee mid-signup has zero memberships, which getCurrentUser() would
 *  otherwise read as "not signed in"). */
export async function currentSessionEmail(reqHeaders?: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await resolveHeaders(reqHeaders) });
  return session?.user.email ?? null;
}

/** Reads an invitation for display on `/invite/accept`, before the invitee
 *  necessarily has a session — `invitations` carries no RLS (it must be
 *  readable pre-auth to get here at all; see its own schema comment), so
 *  this is a plain, unscoped read keyed by the unguessable id in the link. */
export async function getInvitationForAccept(token: string): Promise<InvitationPreview | null> {
  const [row] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      organizationName: organizations.name,
      inviterName: users.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .innerJoin(users, eq(users.id, invitations.inviterId))
    .where(eq(invitations.id, token))
    .limit(1);
  if (!row) return null;

  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, row.email)).limit(1);

  return {
    id: row.id,
    email: row.email,
    role: (row.role ?? "support_agent") as AppRole,
    organizationName: row.organizationName,
    inviterName: row.inviterName,
    hasAccount: Boolean(account),
    valid: row.status === "pending" && row.expiresAt > new Date(),
  };
}

/** The membership write shared by both accept paths below. The status flip
 *  is the guard against a double-accept race — an atomic
 *  `UPDATE ... WHERE status = 'pending'`, the same shape better-auth's own
 *  adapter uses, checked by row count rather than a separate lock — and
 *  throwing inside the callback rolls the whole transaction back, so an
 *  expired invitation never ends up marked accepted.
 *
 *  The membership row IS the grant now — ADR-0005 Phase 3 removed the
 *  separate per-Store grant (`member_stores`) this used to also write.
 *
 *  Does NOT touch any session — that used to be a raw `sessions` update
 *  here, and it was wrong: better-auth's session cookie *caches* a signed
 *  snapshot of the session for 5 minutes (config.ts's `cookieCache`), and a
 *  write straight to the table is invisible to a cookie that was cached
 *  before this ran. Both callers below establish or refresh the session
 *  *after* this returns, through a real better-auth call, which is what
 *  actually re-signs the cookie. */
async function finalizeAcceptance(invitationId: string, userId: string): Promise<{ organizationId: string }> {
  // `invitations` carries no RLS (it must be readable before the
  // Organization scope exists at all — see its schema comment), so this
  // plain read is only to learn *which* Organization to scope the rest of
  // the transaction to.
  const [pending] = await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!pending || pending.status !== "pending" || pending.expiresAt < new Date()) {
    throw new Error("This invitation is no longer valid.");
  }

  return withOrganizationScope(pending.organizationId, async (tx) => {
    // Re-checked with the same atomic, row-count-guarded update the plain
    // read above can't provide by itself — the guard against a double
    // accept racing this one.
    const [accepted] = await tx
      .update(invitations)
      .set({ status: "accepted" })
      .where(and(eq(invitations.id, invitationId), eq(invitations.status, "pending")))
      .returning();
    if (!accepted || accepted.expiresAt < new Date()) {
      throw new Error("This invitation is no longer valid.");
    }

    await tx
      .insert(members)
      .values({ organizationId: accepted.organizationId, userId, role: accepted.role ?? "support_agent" })
      .onConflictDoNothing();

    return { organizationId: accepted.organizationId };
  });
}

/** Accept path for an email the platform has never seen: creates the
 *  account (their own name + password — nobody else ever sets either,
 *  ADR-0005 §5), grants the membership, *then* signs in.
 *
 *  That order is load-bearing, not incidental. `auth.api.signUpEmail` would
 *  create the account and a session in one call — but the session-create
 *  hook (config.ts) reads `activeOrganizationId` off whatever membership
 *  exists *at that instant*, and finds none yet. The resulting session
 *  cookie caches that null for 5 minutes; finalizeAcceptance granting the
 *  membership a moment later doesn't reach an already-cached cookie.
 *  Creating the account and the membership first, then signing in, means
 *  the hook sees the real membership the only time it looks. Written by
 *  hand (not signUpEmail) for the same reason services/staff.ts's old
 *  addStaff was: signUpEmail issues a session immediately, which here would
 *  mean creating it before the membership exists — the exact problem this
 *  ordering avoids. */
export async function acceptInvitationAsNewUser(
  token: string,
  input: { name: string; password: string },
  reqHeaders?: Headers,
): Promise<{ organizationId: string }> {
  const invitation = await getInvitationForAccept(token);
  if (!invitation || !invitation.valid) throw new Error("This invitation is no longer valid.");

  const [user] = await db
    .insert(users)
    // Verified by construction: only someone who controls this inbox could
    // have reached this form at all.
    .values({ name: input.name, email: invitation.email, emailVerified: true })
    .returning({ id: users.id });
  await db.insert(accounts).values({
    issuer: "local:credential",
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await hashPassword(input.password),
  });

  const { organizationId } = await finalizeAcceptance(token, user.id);

  await auth.api.signInEmail({
    body: { email: invitation.email, password: input.password },
    headers: await resolveHeaders(reqHeaders),
  });

  return { organizationId };
}

/** Accept path for someone already signed in as the invited address
 *  (typically: they had an account already — ADR-0005 §5's "linking, not
 *  creating"). Guarded at the call site: the caller checks the session's
 *  email matches before offering this. */
export async function acceptInvitationAsCurrentUser(
  token: string,
  reqHeaders?: Headers,
): Promise<{ organizationId: string }> {
  const requestHeaders = await resolveHeaders(reqHeaders);
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login");

  const invitation = await getInvitationForAccept(token);
  if (!invitation || !invitation.valid) throw new Error("This invitation is no longer valid.");
  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    throw new Error("You're signed in with a different email than this invitation was sent to.");
  }

  const { organizationId } = await finalizeAcceptance(token, session.user.id);

  // Re-stamps the *live* session's active Organization through the plugin's
  // own endpoint rather than a raw table write — setActiveOrganization
  // re-signs the session cookie (setSessionCookie, inside the plugin),
  // which is what actually makes the change visible; a direct write would
  // hit the same stale-cookie-cache problem finalizeAcceptance's comment
  // describes. It also re-checks membership, which by now exists.
  await auth.api.setActiveOrganization({ body: { organizationId }, headers: requestHeaders });

  return { organizationId };
}

export type PendingInvitation = {
  id: string;
  email: string;
  role: AppRole;
  expiresAt: Date;
};

/** Every still-pending, not-yet-expired invitation for the caller's active
 *  Organization — for the Staff screen's "invited, not yet joined" list.
 *  The plugin's listInvitations returns every status ever reached; accepted
 *  and cancelled ones aren't this screen's concern. */
export async function listPendingInvitations(reqHeaders?: Headers): Promise<PendingInvitation[]> {
  const rows = await auth.api.listInvitations({ headers: await resolveHeaders(reqHeaders) });
  const now = new Date();
  return rows
    .filter((r) => r.status === "pending" && new Date(r.expiresAt) > now)
    .map((r) => ({
      id: r.id,
      email: r.email,
      role: (r.role ?? "support_agent") as AppRole,
      expiresAt: new Date(r.expiresAt),
    }));
}

/** Revokes a pending invitation — requireAdmin() at the call site is the
 *  real gate; the plugin's own invitation:cancel permission (orgAdminRole
 *  only) is defence in depth. */
export async function cancelOrganizationInvitation(invitationId: string, reqHeaders?: Headers): Promise<void> {
  await auth.api.cancelInvitation({ body: { invitationId }, headers: await resolveHeaders(reqHeaders) });
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
