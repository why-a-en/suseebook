import { and, desc, eq } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { orderItems, orders, products, customers, CANT_SOURCE_REASON } from "@/db/schema";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icon";

function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** A soft-delete log, not an action screen — items land here once a
 *  Supplier taps "Can't source" on the Purchase Queue (see
 *  purchase-queue/actions.ts's cantSourceAction) and just stay visible
 *  here, read-only, instead of disappearing with no record. Filtered on
 *  CANT_SOURCE_REASON specifically — a Support-initiated cancel from the
 *  Order detail page uses the same "cancelled" status for a different
 *  reason and doesn't belong on this list. Both roles land here: Supplier
 *  caused it, Support needs to know their customer's order has a gap. */
export default async function UnsourcedPage() {
  const rows = await withCurrentOrganization(({ organizationId, tx }) =>
    tx
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        cancelledAt: orderItems.cancelledAt,
        productName: products.name,
        customerName: customers.name,
      })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          eq(orderItems.status, "cancelled"),
          eq(orderItems.cancellationReason, CANT_SOURCE_REASON),
        ),
      )
      .orderBy(desc(orderItems.cancelledAt)),
  );

  return (
    <Screen>
      <TopBar backHref="/home" title="Unsourced" eyebrow={`${rows.length} item${rows.length === 1 ? "" : "s"}`} />
      <ScrollBody>
        {rows.length === 0 ? (
          <EmptyState icon="check-check" title="Nothing here." body="Items a Supplier couldn't source land here instead of just disappearing." />
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-line-hairline px-5 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line-hairline text-text-faint">
                <Icon name="x" size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-ui text-body-strong text-text-strong">
                  {r.productName} <span className="font-normal text-text-faint">×{r.quantity}</span>
                </div>
                <div className="truncate font-ui text-small text-text-faint">
                  {r.customerName}
                  {r.cancelledAt ? ` · ${timeAgo(r.cancelledAt)}` : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </ScrollBody>
    </Screen>
  );
}
