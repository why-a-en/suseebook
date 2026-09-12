import { and, eq, isNull, notInArray } from "drizzle-orm";
import { orderItemModifiers, orderItems, orders } from "@/db/schema";
import { ServiceError, type ServiceContext } from "./types";

// Order writes. No `next/*` imports — see ./types.ts and
// docs/ARCHITECTURE_ROADMAP.md §4.

// Unfinished orders pile up silently if there's no ceiling — a Support Agent
// who starts a new one every time a chat gets complicated and rarely circles
// back would otherwise accumulate an unbounded backlog, most of it abandoned
// rather than genuinely paused. Per user (createdBy), not per Organization:
// this is about one agent's own follow-up queue staying workable, not a
// shared org-wide cap.
export const MAX_OPEN_DRAFTS_PER_USER = 5;

export type SaveOrderInput = {
  /** Set when resuming a saved draft; omitted for a brand-new order. */
  orderId?: string;
  customerId: string;
  notes?: string;
  items: { productId: string; modifierOptionIds: string[]; quantity: number }[];
  /** false leaves it as a draft; true stamps placed_at and releases it. */
  place: boolean;
};

/**
 * Creates an Order — or adds to one already started — and inserts any new
 * Order Items plus their modifier selections, in one transaction.
 *
 * The wizard holds the in-progress cart in client state and only commits
 * here, either as a draft (`place: false`, `placed_at` stays null and the
 * order sits in the list to resume) or placed (`place: true`, at which point
 * every new pending Item shows up in the Purchase Queue per PRD §7.1 step 5).
 * An abandoned wizard that was never saved leaves nothing behind.
 *
 * `place: true` with an empty cart is downgraded to a draft — a placed Order
 * with no items isn't a request anyone can act on, and losing the save
 * outright is worse than parking it. The returned `placed` reflects what
 * actually happened, so callers redirect (or not) accordingly.
 */
export async function saveOrder(
  ctx: ServiceContext,
  input: SaveOrderInput,
): Promise<{ orderId: string; placed: boolean }> {
  if (!input.customerId) throw new ServiceError("Missing customer.");

  // A placed Order is a real request the Supplier works from, so it has to
  // carry at least one item. A save that asks to place an empty cart isn't
  // rejected outright — it's kept as a draft, so the work stays there to
  // resume rather than vanishing. The wizard already blocks this path
  // (handleSave / the disabled Review button); this is the boundary a bug or
  // a future non-UI caller would actually hit.
  const place = input.place && input.items.length > 0;

  let id = input.orderId;
  const notes = input.notes?.trim() || null;

  if (id) {
    await ctx.tx
      .update(orders)
      .set({ notes, ...(place ? { placedAt: new Date() } : {}) })
      .where(and(eq(orders.id, id), eq(orders.organizationId, ctx.organizationId)));

    // The wizard hands back the full pending set every save; reconcile by
    // replacing it. Only pending rows are cleared — a line the Supplier
    // has already bought isn't the composer's to reshape, and the resume
    // query never loaded it into the wizard in the first place. The FK
    // from order_item_modifiers cascades on this delete.
    await ctx.tx
      .delete(orderItems)
      .where(
        and(
          eq(orderItems.orderId, id),
          eq(orderItems.organizationId, ctx.organizationId),
          eq(orderItems.status, "pending"),
        ),
      );
  } else {
    // Only a brand-new order saved *as a draft* counts against the cap —
    // placing outright never creates a draft in the first place, and updating
    // an already-counted draft (the branch above) isn't starting a new one.
    // An empty place-attempt that fell back to a draft above counts too — it
    // is a new draft like any other.
    if (!place) {
      const openDrafts = await ctx.tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, ctx.organizationId),
            eq(orders.createdBy, ctx.userId),
            isNull(orders.placedAt),
          ),
        );

      if (openDrafts.length >= MAX_OPEN_DRAFTS_PER_USER) {
        throw new ServiceError(
          `You already have ${MAX_OPEN_DRAFTS_PER_USER} draft orders — finish or place one before starting another.`,
        );
      }
    }

    const [order] = await ctx.tx
      .insert(orders)
      .values({
        organizationId: ctx.organizationId,
        customerId: input.customerId,
        notes,
        createdBy: ctx.userId,
        placedAt: place ? new Date() : null,
      })
      .returning({ id: orders.id });
    id = order.id;
  }

  if (input.items.length > 0) {
    const insertedItems = await ctx.tx
      .insert(orderItems)
      .values(
        input.items.map((item) => ({
          organizationId: ctx.organizationId,
          orderId: id!,
          productId: item.productId,
          quantity: item.quantity,
        })),
      )
      .returning({ id: orderItems.id });

    // NOTE: pairs each input item with the inserted row at the same index,
    // which assumes INSERT ... RETURNING hands rows back in the order they
    // were supplied. Postgres does in practice, but the SQL standard does not
    // promise it. Carried over unchanged from the Server Action this was
    // extracted from — worth making order-independent, but that is a
    // behaviour change and does not belong in a move.
    const modifierRows = input.items.flatMap((item, i) =>
      item.modifierOptionIds.map((modifierOptionId) => ({
        organizationId: ctx.organizationId,
        orderItemId: insertedItems[i].id,
        modifierOptionId,
      })),
    );

    if (modifierRows.length > 0) {
      await ctx.tx.insert(orderItemModifiers).values(modifierRows);
    }
  }

  return { orderId: id!, placed: place };
}

/**
 * Cancels one Order Item. A soft delete: the row stays, so the Order's notes,
 * the Customer's history and every stage timestamp still reference it — it
 * just drops out of every active view. See ADR-0001 for why Cancelled is
 * reachable from any stage except Completed.
 */
export async function cancelOrderItem(
  ctx: ServiceContext,
  input: { orderItemId: string; reason?: string | null },
): Promise<void> {
  await ctx.tx
    .update(orderItems)
    .set({
      status: "cancelled",
      cancellationReason: input.reason?.trim() || null,
      cancelledAt: new Date(),
    })
    .where(
      and(
        eq(orderItems.id, input.orderItemId),
        eq(orderItems.organizationId, ctx.organizationId),
      ),
    );
}

/**
 * Hard-deletes a draft order and its items (the FK from order_items — and
 * from order_item_modifiers below that — cascades). Only a draft, and only
 * one whose every item is still pending or already cancelled: once the
 * Supplier has bought against a line, the order is a real record and
 * dropping it silently would lose that. Placed orders are never deletable
 * here — cancel their items instead.
 */
export async function deleteDraft(
  ctx: ServiceContext,
  input: { orderId: string },
): Promise<void> {
  const [order] = await ctx.tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.id, input.orderId),
        eq(orders.organizationId, ctx.organizationId),
        isNull(orders.placedAt),
      ),
    )
    .limit(1);
  if (!order) throw new ServiceError("That draft doesn't exist here.");

  const [advanced] = await ctx.tx
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, input.orderId),
        eq(orderItems.organizationId, ctx.organizationId),
        notInArray(orderItems.status, ["pending", "cancelled"]),
      ),
    )
    .limit(1);
  if (advanced) {
    throw new ServiceError("This draft has items the Supplier is already working on — it can't be deleted.");
  }

  await ctx.tx
    .delete(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.organizationId, ctx.organizationId)));
}
