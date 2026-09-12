import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, withOrganizationScope } from "@/db/client";
import { customers, members, organizations, users } from "@/db/schema";

// The test ADR-0002 §9 requires: proof that one Organization cannot read
// another's data, run against real Postgres rather than a mock. RLS is the
// thing being tested, so stubbing the database out would test nothing.
//
// Every assertion here should fail loudly if the `tenant_isolation` policy is
// dropped, or if `app_user` is ever recreated with BYPASSRLS — the two
// mistakes that would silently turn multi-tenancy off. To confirm the test can
// actually fail, temporarily run:
//   alter table customers disable row level security;
// and watch these go red before re-enabling it.

const TAG = `isolation-${Date.now()}`;

let orgA: string;
let orgB: string;
let sharedSupplierId: string;
let customerAId: string;
let customerBId: string;

beforeAll(async () => {
  // `organizations` and `users` carry no RLS policy — they are read to
  // establish the scope, so they cannot be gated on it.
  const [a] = await db
    .insert(organizations)
    .values({ name: `${TAG}-A`, slug: `${TAG}-a` })
    .returning({ id: organizations.id });
  const [b] = await db
    .insert(organizations)
    .values({ name: `${TAG}-B`, slug: `${TAG}-b` })
    .returning({ id: organizations.id });
  orgA = a.id;
  orgB = b.id;

  // A Supplier working for both resellers — the case that forced identity to
  // split from membership in the first place.
  const [supplier] = await db
    .insert(users)
    .values({ name: `${TAG} Supplier`, email: `${TAG}@isolation.test` })
    .returning({ id: users.id });
  sharedSupplierId = supplier.id;

  await db.insert(members).values([
    { organizationId: orgA, userId: sharedSupplierId, role: "supplier" },
    { organizationId: orgB, userId: sharedSupplierId, role: "supplier" },
  ]);

  // Tenant-scoped writes must go through the scope — the policy's USING
  // expression doubles as the INSERT check.
  customerAId = await withOrganizationScope(orgA, async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({ organizationId: orgA, name: `${TAG}-customer-A`, phone: "0900000001" })
      .returning({ id: customers.id });
    return row.id;
  });

  customerBId = await withOrganizationScope(orgB, async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({ organizationId: orgB, name: `${TAG}-customer-B`, phone: "0900000002" })
      .returning({ id: customers.id });
    return row.id;
  });
});

afterAll(async () => {
  await withOrganizationScope(orgA, (tx) => tx.delete(customers).where(eq(customers.organizationId, orgA)));
  await withOrganizationScope(orgB, (tx) => tx.delete(customers).where(eq(customers.organizationId, orgB)));
  await db.delete(members).where(eq(members.userId, sharedSupplierId));
  await db.delete(users).where(eq(users.id, sharedSupplierId));
  await db.delete(organizations).where(inArray(organizations.id, [orgA, orgB]));
});

describe("tenant isolation", () => {
  it("an unfiltered query returns only the scoped Organization's rows", async () => {
    // Deliberately no `where organization_id = ...`. This is the exact bug
    // RLS exists to catch: a query that forgot its tenant filter.
    const rows = await withOrganizationScope(orgA, (tx) => tx.select().from(customers));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgA)).toBe(true);
    expect(rows.map((r) => r.id)).toContain(customerAId);
    expect(rows.map((r) => r.id)).not.toContain(customerBId);
  });

  it("cannot read another Organization's row even when asked for it by id", async () => {
    const rows = await withOrganizationScope(orgA, (tx) =>
      tx.select().from(customers).where(eq(customers.id, customerBId)),
    );

    expect(rows).toHaveLength(0);
  });

  it("cannot write a row into another Organization", async () => {
    await expect(
      withOrganizationScope(orgA, (tx) =>
        tx
          .insert(customers)
          // Scoped to A, claiming to belong to B. The policy's WITH CHECK
          // fallback must refuse this.
          .values({ organizationId: orgB, name: `${TAG}-smuggled`, phone: "0900000003" }),
      ),
    ).rejects.toThrow();

    const leaked = await withOrganizationScope(orgB, (tx) =>
      tx.select().from(customers).where(eq(customers.organizationId, orgB)),
    );
    expect(leaked.map((r) => r.name)).not.toContain(`${TAG}-smuggled`);
  });

  it("a Supplier who belongs to both Organizations still sees only the active one", async () => {
    // Membership in B must not widen what an A-scoped request can read. This
    // is the new risk shared Suppliers introduce (ADR-0002 decision 4).
    const memberships = await db
      .select({ organizationId: members.organizationId })
      .from(members)
      .where(eq(members.userId, sharedSupplierId));
    expect(memberships).toHaveLength(2);

    const asA = await withOrganizationScope(orgA, (tx) => tx.select().from(customers));
    expect(asA.every((r) => r.organizationId === orgA)).toBe(true);

    const asB = await withOrganizationScope(orgB, (tx) => tx.select().from(customers));
    expect(asB.every((r) => r.organizationId === orgB)).toBe(true);

    // And the two views are genuinely different data, not an empty set twice.
    expect(asA.map((r) => r.id)).toContain(customerAId);
    expect(asB.map((r) => r.id)).toContain(customerBId);
  });

  it("membership rows are readable without a scope, since scope is derived from them", async () => {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.userId, sharedSupplierId), eq(members.organizationId, orgB)));

    expect(rows).toHaveLength(1);
  });
});
