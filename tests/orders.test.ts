import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, withOrganizationScope } from "@/db/client";
import {
  customers,
  modifierOptions,
  modifiers,
  orderItemModifiers,
  orderItems,
  orders,
  organizations,
  products,
  stores,
  users,
} from "@/db/schema";
import { MAX_OPEN_DRAFTS_PER_USER, cancelOrderItem, deleteDraft, saveOrder } from "@/services/orders";
import { ServiceError, type ServiceContext } from "@/services/types";

// Testable only because the rules moved out of the Server Action — none of
// this can run inside a Next.js request context.

const TAG = `orders-${Date.now()}`;

let orgId: string;
let otherOrgId: string;
let storeId: string;
let otherStoreId: string;
let userId: string;
let customerId: string;
let productId: string;
let optionId: string;

/** Runs `fn` with a service context for `org`, inside a scoped transaction. */
function asOrg<T>(org: string, fn: (ctx: ServiceContext) => Promise<T>) {
  const sid = org === orgId ? storeId : otherStoreId;
  return withOrganizationScope(org, (tx) => fn({ organizationId: org, storeId: sid, userId, tx }));
}

/** Same, in the main Organization but acting as a different person. */
function asUser<T>(actor: string, fn: (ctx: ServiceContext) => Promise<T>) {
  return withOrganizationScope(orgId, (tx) =>
    fn({ organizationId: orgId, storeId, userId: actor, tx }),
  );
}

const extraUsers: string[] = [];
async function freshUser(label: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ name: `${TAG} ${label}`, email: `${TAG}-${label}@orders.test` })
    .returning({ id: users.id });
  extraUsers.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TAG}-org`, slug: `${TAG}-org` })
    .returning({ id: organizations.id });
  const [other] = await db
    .insert(organizations)
    .values({ name: `${TAG}-other`, slug: `${TAG}-other` })
    .returning({ id: organizations.id });
  orgId = org.id;
  otherOrgId = other.id;

  // `stores` is RLS-scoped — insert each through its own org's scope.
  storeId = await withOrganizationScope(orgId, async (tx) => {
    const [row] = await tx
      .insert(stores)
      .values({ organizationId: orgId, name: `${TAG}-store` })
      .returning({ id: stores.id });
    return row.id;
  });
  otherStoreId = await withOrganizationScope(otherOrgId, async (tx) => {
    const [row] = await tx
      .insert(stores)
      .values({ organizationId: otherOrgId, name: `${TAG}-other-store` })
      .returning({ id: stores.id });
    return row.id;
  });

  const [user] = await db
    .insert(users)
    .values({ name: `${TAG} agent`, email: `${TAG}@orders.test` })
    .returning({ id: users.id });
  userId = user.id;

  await asOrg(orgId, async ({ tx }) => {
    const [customer] = await tx
      .insert(customers)
      .values({ organizationId: orgId, name: `${TAG}-customer`, phone: "0900000000" })
      .returning({ id: customers.id });
    customerId = customer.id;

    const [product] = await tx
      .insert(products)
      .values({
        organizationId: orgId,
        name: `${TAG}-product`,
        description: "fixture",
        createdBy: userId,
      })
      .returning({ id: products.id });
    productId = product.id;

    const [modifier] = await tx
      .insert(modifiers)
      .values({ organizationId: orgId, name: `${TAG}-Color` })
      .returning({ id: modifiers.id });
    const [option] = await tx
      .insert(modifierOptions)
      .values({ organizationId: orgId, modifierId: modifier.id, value: "Black" })
      .returning({ id: modifierOptions.id });
    optionId = option.id;
  });
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    await withOrganizationScope(org, async (tx) => {
      const owned = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.organizationId, org));
      const orderIds = owned.map((o) => o.id);
      if (orderIds.length > 0) {
        const items = await tx
          .select({ id: orderItems.id })
          .from(orderItems)
          .where(inArray(orderItems.orderId, orderIds));
        const itemIds = items.map((i) => i.id);
        if (itemIds.length > 0) {
          await tx
            .delete(orderItemModifiers)
            .where(inArray(orderItemModifiers.orderItemId, itemIds));
          await tx.delete(orderItems).where(inArray(orderItems.id, itemIds));
        }
        await tx.delete(orders).where(inArray(orders.id, orderIds));
      }
      await tx.delete(modifierOptions).where(eq(modifierOptions.organizationId, org));
      await tx.delete(modifiers).where(eq(modifiers.organizationId, org));
      await tx.delete(products).where(eq(products.organizationId, org));
      await tx.delete(customers).where(eq(customers.organizationId, org));
      await tx.delete(stores).where(eq(stores.organizationId, org));
    });
  }
  await db.delete(users).where(inArray(users.id, [userId, ...extraUsers]));
  await db.delete(organizations).where(inArray(organizations.id, [orgId, otherOrgId]));
});

describe("saveOrder", () => {
  it("writes the order, its items and their modifier selections together", async () => {
    const { orderId, placed } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        notes: "  trimmed  ",
        place: true,
        items: [{ productId, modifierOptionIds: [optionId], quantity: 3 }],
      }),
    );

    expect(placed).toBe(true);

    const [order] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orders).where(eq(orders.id, orderId)),
    );
    expect(order.notes).toBe("trimmed");
    // Placing stamps placed_at — that is what releases items to the queue.
    expect(order.placedAt).not.toBeNull();
    expect(order.createdBy).toBe(userId);

    const items = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].status).toBe("pending");

    const mods = await asOrg(orgId, ({ tx }) =>
      tx
        .select()
        .from(orderItemModifiers)
        .where(eq(orderItemModifiers.orderItemId, items[0].id)),
    );
    expect(mods.map((m) => m.modifierOptionId)).toEqual([optionId]);
  });

  it("leaves placed_at null for a draft", async () => {
    const { orderId, placed } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, { customerId, place: false, items: [] }),
    );
    expect(placed).toBe(false);

    const [order] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orders).where(eq(orders.id, orderId)),
    );
    expect(order.placedAt).toBeNull();
  });

  // Fresh users, like the draft-cap tests below: an empty place-attempt now
  // lands as a draft, so it counts against the cap and would otherwise leak
  // into the shared user's tally.
  it("keeps a place with an empty cart as a draft rather than placing it", async () => {
    const user = await freshUser("empty-place");
    const { orderId, placed } = await asUser(user, (ctx) =>
      saveOrder(ctx, { customerId, place: true, items: [] }),
    );
    expect(placed).toBe(false);

    const [order] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orders).where(eq(orders.id, orderId)),
    );
    expect(order.placedAt).toBeNull();
  });

  it("downgrades a resumed draft to a draft when placed with every item removed", async () => {
    const user = await freshUser("empty-resume");
    const { orderId } = await asUser(user, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: false,
        items: [{ productId, modifierOptionIds: [], quantity: 1 }],
      }),
    );

    const { placed } = await asUser(user, (ctx) =>
      saveOrder(ctx, { orderId, customerId, place: true, items: [] }),
    );
    expect(placed).toBe(false);

    const [order] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orders).where(eq(orders.id, orderId)),
    );
    expect(order.placedAt).toBeNull();

    const items = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    expect(items).toHaveLength(0);
  });

  it("reconciles a resumed draft's pending items against the set it's given", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: false,
        items: [{ productId, modifierOptionIds: [optionId], quantity: 1 }],
      }),
    );

    // Resume: same product, new quantity, no modifier — one line, replaced.
    await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        orderId,
        customerId,
        place: false,
        items: [{ productId, modifierOptionIds: [], quantity: 4 }],
      }),
    );

    const items = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4);

    const mods = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, items[0].id)),
    );
    expect(mods).toHaveLength(0); // the old modifier row cascaded away with its item
  });

  it("does not touch a non-pending item when reconciling", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: false,
        items: [{ productId, modifierOptionIds: [], quantity: 2 }],
      }),
    );
    const [item] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    await asOrg(orgId, ({ tx }) =>
      tx.update(orderItems).set({ status: "purchased" }).where(eq(orderItems.id, item.id)),
    );

    // Resume with an empty set — the purchased line must survive.
    await asOrg(orgId, (ctx) =>
      saveOrder(ctx, { orderId, customerId, place: false, items: [] }),
    );

    const after = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(item.id);
    expect(after[0].status).toBe("purchased");
  });

  it("refuses a customer-less order", async () => {
    await expect(
      asOrg(orgId, (ctx) => saveOrder(ctx, { customerId: "", place: false, items: [] })),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  // The cap is per (Organization, createdBy), so this uses its own user and
  // its own count rather than depending on what earlier tests left behind.
  it("caps how many drafts one person can leave open", async () => {
    const capUser = await freshUser("cap");

    for (let i = 0; i < MAX_OPEN_DRAFTS_PER_USER; i++) {
      await asUser(capUser, (ctx) => saveOrder(ctx, { customerId, place: false, items: [] }));
    }

    await expect(
      asUser(capUser, (ctx) => saveOrder(ctx, { customerId, place: false, items: [] })),
    ).rejects.toThrow(/draft orders/);
  });

  it("does not count a placed order against the draft cap", async () => {
    const capUser = await freshUser("placed");

    for (let i = 0; i < MAX_OPEN_DRAFTS_PER_USER; i++) {
      await asUser(capUser, (ctx) => saveOrder(ctx, { customerId, place: false, items: [] }));
    }

    // At the cap, yet placing outright must still work — it never creates a
    // draft in the first place.
    const { orderId } = await asUser(capUser, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: true,
        items: [{ productId, modifierOptionIds: [], quantity: 1 }],
      }),
    );
    expect(orderId).toBeTruthy();
  });
});

describe("cancelOrderItem", () => {
  it("soft-deletes with a reason, leaving the row in place", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: true,
        items: [{ productId, modifierOptionIds: [], quantity: 1 }],
      }),
    );
    const [item] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );

    await asOrg(orgId, (ctx) =>
      cancelOrderItem(ctx, { orderItemId: item.id, reason: "  changed their mind  " }),
    );

    const [after] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.id, item.id)),
    );
    expect(after).toBeDefined(); // soft, not hard
    expect(after.status).toBe("cancelled");
    expect(after.cancellationReason).toBe("changed their mind");
    expect(after.cancelledAt).not.toBeNull();
  });

  it("cannot cancel an Order Item belonging to another Organization", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: true,
        items: [{ productId, modifierOptionIds: [], quantity: 1 }],
      }),
    );
    const [item] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );

    // Scoped to the other Organization, naming a real id from this one.
    await asOrg(otherOrgId, (ctx) => cancelOrderItem(ctx, { orderItemId: item.id }));

    const [after] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.id, item.id)),
    );
    expect(after.status).toBe("pending");
  });
});

describe("deleteDraft", () => {
  it("hard-deletes a draft and cascades its items", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: false,
        items: [{ productId, modifierOptionIds: [optionId], quantity: 1 }],
      }),
    );

    await asOrg(orgId, (ctx) => deleteDraft(ctx, { orderId }));

    const orderRows = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orders).where(eq(orders.id, orderId)),
    );
    expect(orderRows).toHaveLength(0);
    const itemRows = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    expect(itemRows).toHaveLength(0);
  });

  it("refuses a placed order", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: true,
        items: [{ productId, modifierOptionIds: [], quantity: 1 }],
      }),
    );
    await expect(asOrg(orgId, (ctx) => deleteDraft(ctx, { orderId }))).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses a draft whose item the Supplier has started on", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, {
        customerId,
        place: false,
        items: [{ productId, modifierOptionIds: [], quantity: 1 }],
      }),
    );
    const [item] = await asOrg(orgId, ({ tx }) =>
      tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    );
    await asOrg(orgId, ({ tx }) =>
      tx.update(orderItems).set({ status: "purchased" }).where(eq(orderItems.id, item.id)),
    );

    await expect(asOrg(orgId, (ctx) => deleteDraft(ctx, { orderId }))).rejects.toBeInstanceOf(ServiceError);
  });

  it("cannot delete another Organization's draft", async () => {
    const { orderId } = await asOrg(orgId, (ctx) =>
      saveOrder(ctx, { customerId, place: false, items: [] }),
    );
    await expect(asOrg(otherOrgId, (ctx) => deleteDraft(ctx, { orderId }))).rejects.toBeInstanceOf(ServiceError);
    const rows = await asOrg(orgId, ({ tx }) => tx.select().from(orders).where(eq(orders.id, orderId)));
    expect(rows).toHaveLength(1);
  });
});
