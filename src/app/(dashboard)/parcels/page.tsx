import { and, asc, eq, inArray } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { orderItems, orders, products, customers, orderItemModifiers, modifierOptions } from "@/db/schema";
import { ParcelsView, type ParcelItem, type ParcelStage } from "./parcels-view";

const STAGES = ["purchased", "received", "packed"] as const;

// The Support Agent's view of what's arrived and needs packing (docs/PRD.md
// §6.4) — deliberately separate from the full Order log, since "what needs
// packing today" is a different question from "what did we log today."
export default async function ParcelsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const statusFilter: readonly ParcelStage[] =
    status && (STAGES as readonly string[]).includes(status) ? [status as ParcelStage] : STAGES;

  const items: ParcelItem[] = await withCurrentOrganization(async ({ organizationId, tx }) => {
    const rows = await tx
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        quantity: orderItems.quantity,
        status: orderItems.status,
        productName: products.name,
        customerName: customers.name,
        purchasedAt: orderItems.purchasedAt,
        receivedAt: orderItems.receivedAt,
        packedAt: orderItems.packedAt,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          inArray(orderItems.status, statusFilter),
        ),
      )
      .orderBy(asc(orderItems.createdAt));

    const itemIds = rows.map((r) => r.id);
    const selections =
      itemIds.length === 0
        ? []
        : await tx
            .select({ orderItemId: orderItemModifiers.orderItemId, value: modifierOptions.value })
            .from(orderItemModifiers)
            .innerJoin(modifierOptions, eq(modifierOptions.id, orderItemModifiers.modifierOptionId))
            .where(inArray(orderItemModifiers.orderItemId, itemIds));
    const selectionsByItem = new Map<string, string[]>();
    for (const s of selections) {
      const list = selectionsByItem.get(s.orderItemId) ?? [];
      list.push(s.value);
      selectionsByItem.set(s.orderItemId, list);
    }

    return rows.map((r) => ({
      ...r,
      status: r.status as ParcelStage,
      selection: selectionsByItem.get(r.id) ?? [],
      updatedAt: (r.status === "purchased" ? r.purchasedAt : r.status === "received" ? r.receivedAt : r.packedAt) ?? null,
    }));
  });

  return (
    <ParcelsView
      items={items}
      status={status && (STAGES as readonly string[]).includes(status) ? (status as ParcelStage) : "all"}
    />
  );
}
