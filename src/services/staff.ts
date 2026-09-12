import { and, eq, ne } from "drizzle-orm";
import { accounts, members, organizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/hash";
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

  return rows.map((r) => ({ ...r, role: r.role as AppRole }));
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
