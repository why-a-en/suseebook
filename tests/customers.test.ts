import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, withOrganizationScope } from "@/db/client";
import { customers, organizations, stores, users } from "@/db/schema";
import { createCustomer } from "@/services/customers";
import { ServiceError, type ServiceContext } from "@/services/types";

// ADR-0005 Phase 2: a Customer is one record per person per tenant, not one
// per Store they happened to walk into. This file is the regression coverage
// for that — tests/tenant-isolation.test.ts already covers the Organization
// wall itself.

const TAG = `customers-${Date.now()}`;

let orgId: string;
let storeAId: string;
let storeBId: string;
let userId: string;

/** A ServiceContext scoped to `orgId`, with whichever Store is "active" —
 *  createCustomer no longer reads it, so this is only here to prove that. */
function asOrg<T>(activeStoreId: string | null, fn: (ctx: ServiceContext) => Promise<T>) {
  return withOrganizationScope(orgId, (tx) => fn({ organizationId: orgId, storeId: activeStoreId, userId, tx }));
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TAG}-org`, slug: `${TAG}-org` })
    .returning({ id: organizations.id });
  orgId = org.id;

  [storeAId, storeBId] = await withOrganizationScope(orgId, async (tx) => {
    const rows = await tx
      .insert(stores)
      .values([
        { organizationId: orgId, name: `${TAG}-store-A` },
        { organizationId: orgId, name: `${TAG}-store-B` },
      ])
      .returning({ id: stores.id });
    return rows.map((r) => r.id);
  });

  const [user] = await db
    .insert(users)
    .values({ name: `${TAG} agent`, email: `${TAG}@customers.test` })
    .returning({ id: users.id });
  userId = user.id;
});

afterAll(async () => {
  await withOrganizationScope(orgId, async (tx) => {
    await tx.delete(customers).where(eq(customers.organizationId, orgId));
    await tx.delete(stores).where(eq(stores.organizationId, orgId));
  });
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(organizations).where(inArray(organizations.id, [orgId]));
});

describe("createCustomer", () => {
  it("does not require an active Store", async () => {
    const customer = await asOrg(null, (ctx) =>
      createCustomer(ctx, { name: `${TAG}-no-store`, phone: "0911111111", address: "1 Main St" }),
    );
    expect(customer.name).toBe(`${TAG}-no-store`);
  });

  it("still validates name, phone and address", async () => {
    await expect(
      asOrg(storeAId, (ctx) => createCustomer(ctx, { name: "", phone: "0900000000", address: "x" })),
    ).rejects.toThrow(ServiceError);
  });
});

describe("Customer visibility across Stores", () => {
  it("a Customer created while Store A is active is found with Store B active", async () => {
    const created = await asOrg(storeAId, (ctx) =>
      createCustomer(ctx, { name: `${TAG}-walked-into-A`, phone: "0922222222", address: "2 Main St" }),
    );

    // No storeId on the row at all — there is nothing left to switch on.
    const [row] = await withOrganizationScope(orgId, (tx) =>
      tx.select().from(customers).where(eq(customers.id, created.id)),
    );
    expect(row).not.toHaveProperty("storeId");

    // The query the order wizard actually runs (orders/query.ts) has no
    // Store term — asserting that directly here would just re-type the
    // query, so instead prove the thing that term would have broken: a
    // plain organization-scoped read, with Store B "active", still sees it.
    const asFromStoreB = await asOrg(storeBId, ({ organizationId, tx }) =>
      tx.select().from(customers).where(eq(customers.organizationId, organizationId)),
    );
    expect(asFromStoreB.map((c) => c.id)).toContain(created.id);
  });
});
