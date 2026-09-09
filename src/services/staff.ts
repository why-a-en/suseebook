import { and, eq, inArray, ne } from "drizzle-orm";
import { accounts, memberStores, members, organizations, stores, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/hash";
import { isValidEmailSyntax } from "@/lib/email/address";
import { generateTemporaryPassword } from "./password";
import { ServiceError, type AppRole, type ServiceContext } from "./types";

// Staff management for an Organization's own Admin. No `next/*` imports —
// see ./types.ts and docs/ARCHITECTURE_ROADMAP.md §4.
//
// `members` and `users` carry no RLS policy (they are read to *establish*
// the tenant scope, so they cannot be gated on it), which means every query
// here MUST filter by ctx.organizationId by hand. There is no safety net
// underneath this file the way there is for products or orders.

export type { AppRole };

export type StaffMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: AppRole;
  status: "active" | "suspended";
  joinedAt: Date;
  /** Store names this member can work in, in grant order. Empty means no
   *  access at all — reachable only if every one of their grants was later
   *  removed, since addStaff below always creates at least one. */
  storeNames: string[];
};

export async function listStaff(ctx: ServiceContext): Promise<StaffMember[]> {
  const rows = await ctx.tx
    .select({
      memberId: members.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: members.role,
      status: members.status,
      joinedAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, ctx.organizationId))
    .orderBy(members.createdAt);

  const memberIds = rows.map((r) => r.memberId);
  const storeRows =
    memberIds.length === 0
      ? []
      : await ctx.tx
          .select({ memberId: memberStores.memberId, storeName: stores.name })
          .from(memberStores)
          .innerJoin(stores, eq(stores.id, memberStores.storeId))
          .where(inArray(memberStores.memberId, memberIds));

  const storeNamesByMember = new Map<string, string[]>();
  for (const r of storeRows) {
    const list = storeNamesByMember.get(r.memberId) ?? [];
    list.push(r.storeName);
    storeNamesByMember.set(r.memberId, list);
  }

  return rows.map((r) => ({
    ...r,
    role: r.role as AppRole,
    storeNames: storeNamesByMember.get(r.memberId) ?? [],
  }));
}

/**
 * Creates a brand-new person and adds them to this Organization.
 *
 * Deliberately refuses an email that already exists anywhere on the
 * platform. Linking an existing account into an Organization is how a shared
 * Supplier works, but doing it from here would let any Admin attach a
 * stranger's account to their own Organization without that person agreeing
 * — and would leak whether a given email is registered at all. That stays a
 * script we run (`pnpm member:add`), which is friction on purpose.
 */
export async function addStaff(
  ctx: ServiceContext,
  input: { name: string; email: string; role: AppRole; storeIds: string[] },
): Promise<StaffMember & { temporaryPassword: string; organizationName: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) throw new ServiceError("Name is required.");
  if (!email) throw new ServiceError("Email is required.");
  if (!isValidEmailSyntax(email)) throw new ServiceError("Enter a valid email address.");
  if (input.storeIds.length === 0) {
    throw new ServiceError("Pick at least one Store this person can work in.");
  }

  const storeRows = await ctx.tx
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(and(inArray(stores.id, input.storeIds), eq(stores.organizationId, ctx.organizationId)));
  if (storeRows.length !== input.storeIds.length) {
    throw new ServiceError("One of those Stores isn't in this Organization.");
  }

  // For the credential email the caller sends. `organizations` is RLS-exempt,
  // so this is filtered by hand like every other query in this file.
  const [org] = await ctx.tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ctx.organizationId))
    .limit(1);

  const [existing] = await ctx.tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    throw new ServiceError(
      "That email already has an account. Ask us to add them to this Organization.",
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  const [user] = await ctx.tx
    .insert(users)
    // Flagged from birth: this password was chosen by the Admin, not by
    // the person who will use it.
    .values({ name, email, mustChangePassword: true })
    .returning({ id: users.id, name: users.name, email: users.email });

  // Written by hand rather than through better-auth's sign-up endpoint,
  // which would also issue a session and swap the Admin's own login. The
  // shape has to match what sign-in looks up exactly: issuer
  // `local:credential`, providerId `credential`, accountId = the user id.
  // Verified empirically against better-auth 1.7.2 — see
  // docs/plans/better-auth-migration.md.
  await ctx.tx.insert(accounts).values({
    issuer: "local:credential",
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await hashPassword(temporaryPassword),
  });

  const [member] = await ctx.tx
    .insert(members)
    .values({ organizationId: ctx.organizationId, userId: user.id, role: input.role })
    .returning({ id: members.id, status: members.status, createdAt: members.createdAt });

  await ctx.tx
    .insert(memberStores)
    .values(input.storeIds.map((storeId) => ({ memberId: member.id, storeId })));

  // The only time this value exists in readable form. The caller emails it
  // to the new member once; nothing persists it.
  return {
    memberId: member.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: input.role,
    status: member.status,
    joinedAt: member.createdAt,
    storeNames: storeRows.map((s) => s.name),
    temporaryPassword,
    organizationName: org.name,
  };
}

/**
 * Issues a new temporary password for a member who has lost theirs, and
 * flags the account so they must replace it on next sign-in.
 *
 * This is the recovery path, deliberately in place of self-service "forgot
 * password": with no email provider there is no channel only the account
 * owner controls, and an email address is not a secret. An Admin who knows
 * who is asking is a stronger check than one who knows their address.
 *
 * Any Admin may reset any member, including another Admin — an Organization
 * with two Admins can recover itself without us. Resetting your own is
 * pointless rather than harmful (you would then be forced to change it),
 * and the Staff screen does not offer it.
 */
export async function resetStaffPassword(
  ctx: ServiceContext,
  memberId: string,
): Promise<{ email: string; name: string; organizationName: string; temporaryPassword: string }> {
  const target = await requireMember(ctx, memberId);
  const temporaryPassword = generateTemporaryPassword();

  const [account] = await ctx.tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, target.userId), eq(accounts.providerId, "credential")))
    .limit(1);

  if (!account) throw new ServiceError("That account has no password to reset.");

  await ctx.tx
    .update(accounts)
    .set({ password: await hashPassword(temporaryPassword), updatedAt: new Date() })
    .where(eq(accounts.id, account.id));

  const [user] = await ctx.tx
    .update(users)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(users.id, target.userId))
    .returning({ email: users.email, name: users.name });

  const [org] = await ctx.tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, ctx.organizationId))
    .limit(1);

  return {
    email: user.email,
    name: user.name,
    organizationName: org.name,
    temporaryPassword,
  };
}

export async function changeStaffRole(
  ctx: ServiceContext,
  input: { memberId: string; role: AppRole },
): Promise<void> {
  const target = await requireMember(ctx, input.memberId);

  if (target.userId === ctx.userId) {
    throw new ServiceError("You can't change your own role.");
  }
  if (target.role === "admin" && input.role !== "admin") {
    await assertNotLastAdmin(ctx, target.memberId);
  }

  await ctx.tx
    .update(members)
    .set({ role: input.role })
    .where(
      and(eq(members.id, input.memberId), eq(members.organizationId, ctx.organizationId)),
    );
}

export async function setStaffStatus(
  ctx: ServiceContext,
  input: { memberId: string; status: "active" | "suspended" },
): Promise<void> {
  const target = await requireMember(ctx, input.memberId);

  if (target.userId === ctx.userId) {
    throw new ServiceError("You can't suspend your own account.");
  }
  if (input.status === "suspended" && target.role === "admin") {
    await assertNotLastAdmin(ctx, target.memberId);
  }

  await ctx.tx
    .update(members)
    .set({ status: input.status })
    .where(
      and(eq(members.id, input.memberId), eq(members.organizationId, ctx.organizationId)),
    );
}

/**
 * Drops the membership. The `users` row survives, so every Order and Product
 * they created stays attributable — `created_by` still resolves to a real
 * person. Suspending is the reversible option; this is not.
 */
export async function removeStaff(ctx: ServiceContext, memberId: string): Promise<void> {
  const target = await requireMember(ctx, memberId);

  if (target.userId === ctx.userId) {
    throw new ServiceError("You can't remove yourself from this Organization.");
  }
  if (target.role === "admin") {
    await assertNotLastAdmin(ctx, memberId);
  }

  await ctx.tx
    .delete(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, ctx.organizationId)));
}

/** Scoped lookup — a member id from another Organization must not resolve. */
async function requireMember(ctx: ServiceContext, memberId: string) {
  const [row] = await ctx.tx
    .select({ memberId: members.id, userId: members.userId, role: members.role })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, ctx.organizationId)))
    .limit(1);

  if (!row) throw new ServiceError("That person isn't in this Organization.");
  return row;
}

/**
 * An Organization with no active Admin has nobody who can add one back, and
 * fixing it needs us and a database console. Cheaper to refuse the last step
 * than to recover from it.
 */
async function assertNotLastAdmin(ctx: ServiceContext, excludingMemberId: string) {
  const remaining = await ctx.tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.organizationId, ctx.organizationId),
        eq(members.role, "admin"),
        eq(members.status, "active"),
        ne(members.id, excludingMemberId),
      ),
    )
    .limit(1);

  if (remaining.length === 0) {
    throw new ServiceError(
      "This is the last active Admin. Promote someone else first, or the Organization would lock itself out.",
    );
  }
}
