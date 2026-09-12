"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { withCurrentOrganization } from "@/lib/tenancy";
import { orderItems, CANT_SOURCE_REASON } from "@/db/schema";

/**
 * Marks a specific set of pending Order Items as Purchased — not the whole
 * Product group (docs/PRD.md §6.3's batch-purchase is still the common
 * case, but a Supplier can only mark it whole if the checkboxes in
 * PurchaseGroupCard's breakdown are all left checked, which is the
 * default). Restricting the `where` to `status = "pending"` makes this
 * idempotent against a double-click racing the revalidated data.
 */
export async function markPurchasedAction(orderItemIds: string[]) {
  if (orderItemIds.length === 0) return;

  await withCurrentOrganization(async ({ organizationId, tx }) => {
    await tx
      .update(orderItems)
      .set({ status: "purchased", purchasedAt: new Date() })
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          inArray(orderItems.id, orderItemIds),
          eq(orderItems.status, "pending"),
        ),
      );
  });

  revalidatePath("/purchase-queue");
  revalidatePath("/parcels");
}

/**
 * The other half of "couldn't purchase them all": cancels a set of pending
 * Order Items outright rather than leaving them stuck pending forever. Not
 * a new status — docs/adr/0001-order-item-lifecycle-and-packing.md already
 * has Cancelled reachable from Pending — this just exposes that from the
 * Purchase Queue itself (previously only reachable from the Order detail
 * page, which a Supplier has no reason to be looking at) so this decision
 * gets made by whoever's actually looking at the listing, not relayed
 * through Support after the fact. A soft delete, not a hard one — the row
 * stays put (see CANT_SOURCE_REASON's doc comment in db/schema.ts), it just
 * drops out of every active view and resurfaces on the dedicated
 * /unsourced page instead.
 */
export async function cantSourceAction(orderItemIds: string[]) {
  if (orderItemIds.length === 0) return;

  await withCurrentOrganization(async ({ organizationId, tx }) => {
    await tx
      .update(orderItems)
      .set({ status: "cancelled", cancellationReason: CANT_SOURCE_REASON, cancelledAt: new Date() })
      .where(
        and(
          eq(orderItems.organizationId, organizationId),
          inArray(orderItems.id, orderItemIds),
          eq(orderItems.status, "pending"),
        ),
      );
  });

  revalidatePath("/purchase-queue");
  revalidatePath("/parcels");
  revalidatePath("/unsourced");
}
