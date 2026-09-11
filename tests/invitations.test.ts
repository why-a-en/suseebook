import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, withOrganizationScope } from "@/db/client";
import { auth } from "@/lib/auth/config";
import { hashPassword } from "@/lib/auth/hash";
import {
  accounts,
  invitations,
  memberStores,
  members,
  organizations,
  sessions,
  stores,
  users,
} from "@/db/schema";
import {
  acceptInvitationAsCurrentUser,
  acceptInvitationAsNewUser,
  getInvitationForAccept,
  inviteToOrganization,
} from "@/lib/auth";

// Coverage for docs/adr/0005-store-as-sole-tenant.md §6 / §7: the only way
// anyone joins an Organization. auth/index.ts's wrappers all take an
// optional Headers override for exactly this reason — next/headers' own
// headers() throws outside a request scope, which is where this file runs.

const TAG = `invite-${Date.now()}`;
const PASSWORD = "password123";

let orgId: string;
let storeId: string;
let adminUserId: string;
let adminHeaders: Headers;
const extraUserIds: string[] = [];

/** Signs in for real and hands back a Cookie header carrying the session —
 *  the only way to make a genuinely-authenticated auth.api call outside a
 *  request. asResponse:true is what exposes the Set-Cookie better-auth
 *  would otherwise only ever write to a live HTTP response. */
async function sessionHeadersFor(email: string, password: string): Promise<Headers> {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Sign-in did not set a session cookie.");
  return new Headers({ cookie: setCookie.split(";")[0] });
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TAG}-org`, slug: `${TAG}-org` })
    .returning({ id: organizations.id });
  orgId = org.id;

  const [admin] = await db
    .insert(users)
    .values({ name: `${TAG} admin`, email: `${TAG}-admin@invite.test` })
    .returning({ id: users.id });
  adminUserId = admin.id;
  await db.insert(accounts).values({
    issuer: "local:credential",
    accountId: admin.id,
    providerId: "credential",
    userId: admin.id,
    password: await hashPassword(PASSWORD),
  });
  await db.insert(members).values({ organizationId: orgId, userId: adminUserId, role: "admin" });

  storeId = await withOrganizationScope(orgId, async (tx) => {
    const [store] = await tx.insert(stores).values({ organizationId: orgId, name: `${TAG}-store` }).returning({ id: stores.id });
    return store.id;
  });

  // The session-create hook (config.ts) stamps activeOrganizationId from the
  // admin's sole membership, which is what lets createInvitation below infer
  // "this Organization" without it being passed explicitly.
  adminHeaders = await sessionHeadersFor(`${TAG}-admin@invite.test`, PASSWORD);
});

afterAll(async () => {
  const memberRows = await db.select({ id: members.id, userId: members.userId }).from(members).where(eq(members.organizationId, orgId));
  const userIds = [...new Set([adminUserId, ...memberRows.map((m) => m.userId), ...extraUserIds])];

  if (memberRows.length > 0) {
    await db.delete(memberStores).where(inArray(memberStores.memberId, memberRows.map((m) => m.id)));
  }
  await db.delete(members).where(eq(members.organizationId, orgId));
  await db.delete(invitations).where(eq(invitations.organizationId, orgId));
  await withOrganizationScope(orgId, (tx) => tx.delete(stores).where(eq(stores.organizationId, orgId)));
  if (userIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db.delete(accounts).where(inArray(accounts.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("inviteToOrganization + getInvitationForAccept", () => {
  it("creates a pending invitation, readable before the invitee has any session", async () => {
    const email = `${TAG}-new@invite.test`;
    const { invitationId } = await inviteToOrganization({ email, role: "support_agent" }, adminHeaders);

    const preview = await getInvitationForAccept(invitationId);
    expect(preview).not.toBeNull();
    expect(preview!.email).toBe(email);
    expect(preview!.role).toBe("support_agent");
    expect(preview!.organizationName).toBe(`${TAG}-org`);
    expect(preview!.valid).toBe(true);
    expect(preview!.hasAccount).toBe(false);
  });

  it("flags an email that already has an account", async () => {
    const email = `${TAG}-known@invite.test`;
    const [user] = await db.insert(users).values({ name: "Known", email }).returning({ id: users.id });
    extraUserIds.push(user.id);

    const { invitationId } = await inviteToOrganization({ email, role: "supplier" }, adminHeaders);
    const preview = await getInvitationForAccept(invitationId);
    expect(preview!.hasAccount).toBe(true);
  });

  it("returns null for a token that was never an invitation", async () => {
    expect(await getInvitationForAccept("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("acceptInvitationAsNewUser", () => {
  it("creates the account, the membership, a grant on every Store, and marks the invitation accepted", async () => {
    const email = `${TAG}-accept-new@invite.test`;
    const { invitationId } = await inviteToOrganization({ email, role: "support_agent" }, adminHeaders);

    const { organizationId } = await acceptInvitationAsNewUser(
      invitationId,
      { name: "New Hire", password: PASSWORD },
      new Headers(),
    );
    expect(organizationId).toBe(orgId);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user).toBeDefined();
    expect(user.name).toBe("New Hire");
    extraUserIds.push(user.id);

    const [member] = await db
      .select()
      .from(members)
      .where(and(eq(members.organizationId, orgId), eq(members.userId, user.id)));
    expect(member.role).toBe("support_agent");
    expect(member.status).toBe("active");

    const grants = await db.select({ storeId: memberStores.storeId }).from(memberStores).where(eq(memberStores.memberId, member.id));
    expect(grants.map((g) => g.storeId)).toEqual([storeId]);

    // Not offered again — a second acceptance attempt is refused, below.
    const preview = await getInvitationForAccept(invitationId);
    expect(preview!.valid).toBe(false);
  });

  it("refuses an expired invitation, and does not create an account for it", async () => {
    const email = `${TAG}-expired@invite.test`;
    const { invitationId } = await inviteToOrganization({ email, role: "support_agent" }, adminHeaders);
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, invitationId));

    await expect(
      acceptInvitationAsNewUser(invitationId, { name: "Too Late", password: PASSWORD }, new Headers()),
    ).rejects.toThrow(/no longer valid/);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user).toBeUndefined();
  });

  it("refuses to accept the same invitation twice", async () => {
    const email = `${TAG}-twice@invite.test`;
    const { invitationId } = await inviteToOrganization({ email, role: "support_agent" }, adminHeaders);

    const first = await acceptInvitationAsNewUser(invitationId, { name: "First", password: PASSWORD }, new Headers());
    extraUserIds.push((await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id);
    expect(first.organizationId).toBe(orgId);

    await expect(
      acceptInvitationAsNewUser(invitationId, { name: "Second", password: PASSWORD }, new Headers()),
    ).rejects.toThrow();
  });
});

describe("acceptInvitationAsCurrentUser", () => {
  it("adds the membership for someone already signed in as the invited address", async () => {
    const email = `${TAG}-existing@invite.test`;
    const [user] = await db.insert(users).values({ name: "Existing", email }).returning({ id: users.id });
    extraUserIds.push(user.id);
    await db.insert(accounts).values({
      issuer: "local:credential",
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await hashPassword(PASSWORD),
    });

    const { invitationId } = await inviteToOrganization({ email, role: "supplier" }, adminHeaders);
    const theirHeaders = await sessionHeadersFor(email, PASSWORD);

    const { organizationId } = await acceptInvitationAsCurrentUser(invitationId, theirHeaders);
    expect(organizationId).toBe(orgId);

    const [member] = await db
      .select()
      .from(members)
      .where(and(eq(members.organizationId, orgId), eq(members.userId, user.id)));
    expect(member.role).toBe("supplier");
  });

  it("refuses when signed in as a different email than the invitation", async () => {
    const invited = `${TAG}-mismatch@invite.test`;
    const { invitationId } = await inviteToOrganization({ email: invited, role: "support_agent" }, adminHeaders);

    // adminHeaders is a real, live session — just for an email that isn't
    // the invitee.
    await expect(acceptInvitationAsCurrentUser(invitationId, adminHeaders)).rejects.toThrow(/different email/);

    const [member] = await db
      .select()
      .from(members)
      .where(and(eq(members.organizationId, orgId), eq(members.userId, adminUserId)));
    // Still just the one (admin's original) membership — the mismatched
    // accept must not have granted a second.
    expect(member).toBeDefined();
  });
});
