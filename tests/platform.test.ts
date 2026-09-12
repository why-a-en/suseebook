import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { invitations, organizations, users } from "@/db/schema";
import {
  cancelPlatformInvitation,
  createOrganization,
  getOrganizationDetail,
  resendPlatformInvitation,
} from "@/services/platform";
import { ServiceError } from "@/services/types";

// Phase 4 of docs/plans/store-as-tenant.md: pending-invite management for
// the operator console. createOrganization/getOrganizationDetail's own
// coverage predates this file — this is just the new resend/cancel surface,
// direct DB writes rather than through the org plugin for the same reason
// createOrganization itself is (a Platform Admin has no membership anywhere
// to run auth.api.createInvitation/cancelInvitation against).

const TAG = `platform-${Date.now()}`;

let operatorId: string;
const orgIds: string[] = [];

beforeAll(async () => {
  const [operator] = await db
    .insert(users)
    .values({ name: `${TAG} operator`, email: `${TAG}-operator@platform.test` })
    .returning({ id: users.id });
  operatorId = operator.id;
});

afterAll(async () => {
  if (orgIds.length > 0) {
    await db.delete(invitations).where(inArray(invitations.organizationId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  await db.delete(users).where(eq(users.id, operatorId));
});

async function freshStore(label: string) {
  const created = await createOrganization({
    organizationName: `${TAG}-${label}`,
    adminEmail: `${TAG}-${label}-admin@platform.test`,
    invitedById: operatorId,
  });
  orgIds.push(created.organizationId);
  return created;
}

describe("getOrganizationDetail", () => {
  it("lists the invitation createOrganization just issued as pending", async () => {
    const created = await freshStore("detail");
    const detail = await getOrganizationDetail(created.organizationId);
    expect(detail!.pendingInvitations).toHaveLength(1);
    expect(detail!.pendingInvitations[0]).toMatchObject({
      id: created.invitationId,
      email: created.adminEmail,
      role: "admin",
    });
  });
});

describe("resendPlatformInvitation", () => {
  it("cancels the old row and issues a fresh one for the same address", async () => {
    const created = await freshStore("resend");

    const resent = await resendPlatformInvitation(created.invitationId, operatorId);
    expect(resent.email).toBe(created.adminEmail);
    expect(resent.invitationId).not.toBe(created.invitationId);

    const [old] = await db.select().from(invitations).where(eq(invitations.id, created.invitationId));
    expect(old.status).toBe("cancelled");

    const [fresh] = await db.select().from(invitations).where(eq(invitations.id, resent.invitationId));
    expect(fresh.status).toBe("pending");
    expect(fresh.email).toBe(created.adminEmail);
    expect(fresh.organizationId).toBe(created.organizationId);

    const detail = await getOrganizationDetail(created.organizationId);
    expect(detail!.pendingInvitations.map((i) => i.id)).toEqual([resent.invitationId]);
  });

  it("refuses to resend one that's already been cancelled", async () => {
    const created = await freshStore("resend-twice");
    await resendPlatformInvitation(created.invitationId, operatorId);

    await expect(resendPlatformInvitation(created.invitationId, operatorId)).rejects.toThrow(
      ServiceError,
    );
  });
});

describe("cancelPlatformInvitation", () => {
  it("marks a pending invitation cancelled", async () => {
    const created = await freshStore("cancel");

    await cancelPlatformInvitation(created.invitationId);

    const [row] = await db.select().from(invitations).where(eq(invitations.id, created.invitationId));
    expect(row.status).toBe("cancelled");

    const detail = await getOrganizationDetail(created.organizationId);
    expect(detail!.pendingInvitations).toHaveLength(0);
  });

  it("is a no-op against an invitation that isn't pending", async () => {
    const created = await freshStore("cancel-twice");
    await cancelPlatformInvitation(created.invitationId);

    // No throw — cancelling something already cancelled just does nothing.
    await expect(cancelPlatformInvitation(created.invitationId)).resolves.toBeUndefined();
  });
});
