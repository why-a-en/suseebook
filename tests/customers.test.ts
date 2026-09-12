import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, withOrganizationScope } from "@/db/client";
import { customers, organizations, users } from "@/db/schema";
import { createCustomer } from "@/services/customers";
import { ServiceError, type ServiceContext } from "@/services/types";

// ADR-0005 Phase 2: a Customer is one record per person per tenant. Phase 3
// then removed the Store sub-layer entirely, so there is no longer a
// "which Store were they at" question to ask at all — this file just covers
// createCustomer's own validation now; tests/tenant-isolation.test.ts covers
// the Organization wall.

const TAG = `customers-${Date.now()}`;

let orgId: string;
let userId: string;

function asOrg<T>(fn: (ctx: ServiceContext) => Promise<T>) {
  return withOrganizationScope(orgId, (tx) => fn({ organizationId: orgId, userId, tx }));
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TAG}-org`, slug: `${TAG}-org` })
    .returning({ id: organizations.id });
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({ name: `${TAG} agent`, email: `${TAG}@customers.test` })
    .returning({ id: users.id });
  userId = user.id;
});

afterAll(async () => {
  await withOrganizationScope(orgId, (tx) => tx.delete(customers).where(eq(customers.organizationId, orgId)));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(organizations).where(inArray(organizations.id, [orgId]));
});

describe("createCustomer", () => {
  it("creates a customer scoped to the caller's Store", async () => {
    const customer = await asOrg((ctx) =>
      createCustomer(ctx, { name: `${TAG}-new`, phone: "0911111111", address: "1 Main St" }),
    );
    expect(customer.name).toBe(`${TAG}-new`);

    const [row] = await asOrg(({ tx }) => tx.select().from(customers).where(eq(customers.id, customer.id)));
    expect(row.organizationId).toBe(orgId);
  });

  it("still validates name, phone and address", async () => {
    await expect(
      asOrg((ctx) => createCustomer(ctx, { name: "", phone: "0900000000", address: "x" })),
    ).rejects.toThrow(ServiceError);
  });
});
