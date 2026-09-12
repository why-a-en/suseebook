import { asc, and, eq, gte, lte, inArray } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { orderItems, orders, products, productImages, customers, orderItemModifiers, modifierOptions } from "@/db/schema";
import { resolveDateWindow } from "@/lib/date-range";
import { PurchaseQueueView, type PurchaseGroup } from "./purchase-queue-view";

// The Supplier's dedicated home screen (docs/PRD.md §6.3) — the core
// feature: pending Order Items grouped by Product, across every order and
// customer, so today's demand is visible at a glance and clearable in one
// batch tap per product, not by scanning individual orders.
//
// Fetches individual pending rows (not a SQL GROUP BY) and groups them in
// JS, because the reskin's PurchaseGroupCard has a real per-customer
// breakdown on expand — the previous version only fetched the aggregate, so
// that breakdown had nothing to show. Search is client-side over the already
// -fetched groups (matches the design source's PurchaseQueueScreen.jsx);
// pending-queue size for one shop doesn't warrant a server round-trip per
// keystroke.
export default async function PurchaseQueuePage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  // Filters on when the Item was ordered, not on the Order header — the
  // queue's unit of work is the Order Item, and an item added to a draft
  // days after its order was started is today's demand, not that day's.
  const dateWindow = resolveDateWindow(await searchParams);

  const groups = await withCurrentOrganization(async ({ organizationId, tx }) => {
    const rows = await tx
      .select({
        orderItemId: orderItems.id,
        productId: products.id,
        productName: products.name,
        sourceUrl: products.sourceUrl,
        orderId: orderItems.orderId,
        quantity: orderItems.quantity,
        customerName: customers.name,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          eq(orderItems.status, "pending"),
          ...(dateWindow.from ? [gte(orderItems.createdAt, dateWindow.from)] : []),
          ...(dateWindow.to ? [lte(orderItems.createdAt, dateWindow.to)] : []),
        ),
      );

    const productIds = [...new Set(rows.map((r) => r.productId))];
    const orderItemIds = rows.map((r) => r.orderItemId);

    const [images, selections] = await Promise.all([
      productIds.length === 0
        ? []
        : tx
            .select({ productId: productImages.productId, url: productImages.url })
            .from(productImages)
            .where(inArray(productImages.productId, productIds))
            .orderBy(asc(productImages.sortOrder)),
      orderItemIds.length === 0
        ? []
        : tx
            .select({ orderItemId: orderItemModifiers.orderItemId, value: modifierOptions.value })
            .from(orderItemModifiers)
            .innerJoin(modifierOptions, eq(modifierOptions.id, orderItemModifiers.modifierOptionId))
            .where(inArray(orderItemModifiers.orderItemId, orderItemIds)),
    ]);

    const primaryImageByProduct = new Map<string, string>();
    for (const image of images) {
      if (!primaryImageByProduct.has(image.productId)) primaryImageByProduct.set(image.productId, image.url);
    }
    const selectionsByItem = new Map<string, string[]>();
    for (const s of selections) {
      const list = selectionsByItem.get(s.orderItemId) ?? [];
      list.push(s.value);
      selectionsByItem.set(s.orderItemId, list);
    }

    type Working = PurchaseGroup & { orderIdSet: Set<string> };
    const byProduct = new Map<string, Working>();
    for (const row of rows) {
      let group = byProduct.get(row.productId);
      if (!group) {
        group = {
          productId: row.productId,
          productName: row.productName,
          sourceUrl: row.sourceUrl,
          imageUrl: primaryImageByProduct.get(row.productId),
          totalQuantity: 0,
          orderCount: 0,
          breakdown: [],
          orderIdSet: new Set(),
        };
        byProduct.set(row.productId, group);
      }
      group.totalQuantity += row.quantity;
      group.orderIdSet.add(row.orderId);
      group.breakdown.push({
        orderItemId: row.orderItemId,
        customer: row.customerName,
        selection: (selectionsByItem.get(row.orderItemId) ?? []).join(" / "),
        qty: row.quantity,
      });
    }

    return Array.from(byProduct.values()).map(({ orderIdSet, ...g }) => ({ ...g, orderCount: orderIdSet.size }));
  });

  return <PurchaseQueueView groups={groups} window={dateWindow} />;
}
