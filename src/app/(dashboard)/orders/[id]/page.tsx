import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { isUuid } from "@/lib/uuid";
import {
  orders,
  orderItems,
  orderItemModifiers,
  modifierOptions,
  products,
  customers,
} from "@/db/schema";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { Badge, type OrderItemStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cancelOrderItemAction } from "../actions";

const CANCELLABLE_STATUSES = ["pending", "purchased", "received", "packed"] as const;

function display(status: string): OrderItemStatus {
  return (status.charAt(0).toUpperCase() + status.slice(1)) as OrderItemStatus;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await params;

  // orders.id is a uuid column — a non-UUID segment (a typo, a stale link, a
  // bot probing routes) would otherwise crash the query with a raw Postgres
  // "invalid input syntax for type uuid" error instead of a normal 404.
  if (!isUuid(orderId)) notFound();

  const data = await withCurrentOrganization(async ({ organizationId, tx }) => {
    const [order] = await tx
      .select({
        id: orders.id,
        notes: orders.notes,
        createdAt: orders.createdAt,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerAddress: customers.address,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
      .limit(1);
    if (!order) return null;

    const items = await tx
      .select({
        id: orderItems.id,
        productName: products.name,
        quantity: orderItems.quantity,
        status: orderItems.status,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt));

    const itemIds = items.map((item) => item.id);
    const modifierRows =
      itemIds.length === 0
        ? []
        : await tx
            .select({ orderItemId: orderItemModifiers.orderItemId, value: modifierOptions.value })
            .from(orderItemModifiers)
            .innerJoin(modifierOptions, eq(modifierOptions.id, orderItemModifiers.modifierOptionId))
            .where(inArray(orderItemModifiers.orderItemId, itemIds));

    const modifiersByItem = new Map<string, string[]>();
    for (const row of modifierRows) {
      const list = modifiersByItem.get(row.orderItemId) ?? [];
      list.push(row.value);
      modifiersByItem.set(row.orderItemId, list);
    }

    return {
      order,
      items: items.map((item) => ({ ...item, modifiers: modifiersByItem.get(item.id) ?? [] })),
    };
  });

  if (!data) notFound();
  const { order, items } = data;

  return (
    <Screen>
      {/* No "add item" action: an Order is closed to new Items once placed
          (see the note above cancelOrderItemAction in ../actions.ts). What
          can still change here is cancelling an Item that can't be
          fulfilled. */}
      <TopBar title={order.customerName} eyebrow={order.customerPhone} backHref="/orders" />
      <ScrollBody>
        <div className="grid gap-4 px-5 py-4">
          {order.customerAddress && <p className="font-ui text-small text-text-muted">{order.customerAddress}</p>}
          {order.notes && <p className="font-ui text-small text-text-body">{order.notes}</p>}

          <section className="grid gap-2">
            <span className="font-mono text-label tracking-label uppercase text-text-faint">Items</span>

            {/* Reachable only for an order whose items were all cancelled —
                items can't be added back here, so the copy doesn't invite
                it. */}
            {items.length === 0 ? (
              <EmptyState icon="package" title="Nothing on this order." body="Every item on it was cancelled." />
            ) : (
              items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-line-hairline p-3">
                  <div>
                    <p className="font-ui text-body-strong text-text-strong">{item.productName}</p>
                    <p className="mt-0.5 font-ui text-small text-text-muted">
                      {item.modifiers.length > 0 ? `${item.modifiers.join(", ")} · ` : ""}
                      qty {item.quantity}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge status={display(item.status)} size="sm" />
                    {(CANCELLABLE_STATUSES as readonly string[]).includes(item.status) && (
                      <form action={cancelOrderItemAction}>
                        <input type="hidden" name="orderItemId" value={item.id} />
                        <input type="hidden" name="orderId" value={order.id} />
                        <button type="submit" className="cursor-pointer border-none bg-transparent font-ui text-small text-danger underline underline-offset-2 outline-none transition-transform duration-instant ease-standard active:scale-95 focus-visible:shadow-[var(--focus-ring)]">
                          Cancel
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </ScrollBody>
    </Screen>
  );
}
