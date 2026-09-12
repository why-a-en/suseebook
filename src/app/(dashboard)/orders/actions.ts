"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withCurrentOrganization, withCurrentStore } from "@/lib/tenancy";
import { createCustomer } from "@/services/customers";
import { cancelOrderItem, deleteDraft, saveOrder, type SaveOrderInput } from "@/services/orders";
import {
  fetchOrdersPage,
  searchCustomers,
  type OrdersCursor,
  type OrdersFilters,
  type OrdersPage,
} from "./query";
import type { WizardCustomer } from "./new-order-wizard";

// Thin wrappers. The rules — the draft cap, what a save writes, what
// cancelling means — live in src/services/orders.ts and customers.ts. What
// stays here is what a service cannot do: resolve the session and tell
// Next.js what to re-render. See docs/ARCHITECTURE_ROADMAP.md §4.

/**
 * The next page of the Order log, for the list's "Load more".
 *
 * The list can't page by navigation: a new `?cursor=` would *replace* the
 * rendered page rather than extend it, and the point of loading more is to
 * keep what's already on screen (and the scroll position that goes with it).
 * So the first page is rendered by the route from searchParams, and every
 * page after it comes through here and is appended client-side.
 *
 * The filters arrive from the client rather than being re-derived here,
 * which is safe: they only ever narrow, and `fetchOrdersPage` scopes to the
 * caller's organization through `withCurrentOrganization` (with RLS behind
 * it) no matter what is passed in. A tampered filter can hide rows from the
 * person doing the tampering; it can't reach another org's.
 */
export async function loadMoreOrdersAction(
  filters: OrdersFilters,
  cursor: OrdersCursor,
): Promise<OrdersPage> {
  return fetchOrdersPage(filters, cursor);
}

/**
 * Customer search for the order wizard's picker — debounced from the client.
 *
 * An action rather than a URL param, unlike the Order log's search: the
 * wizard holds a cart, a step and a half-configured product in client state,
 * and none of that is anywhere durable until Save. Routing the search through
 * the URL would re-render the route on every pause in typing, for a control
 * that is one step of three.
 */
export async function searchCustomersAction(query: string): Promise<WizardCustomer[]> {
  return searchCustomers(query);
}

export async function createCustomerAction(input: {
  name: string;
  phone: string;
  address: string;
}) {
  const customer = await withCurrentOrganization((ctx) => createCustomer(ctx, input));
  revalidatePath("/customers");
  return customer;
}

export async function saveOrderAction(input: SaveOrderInput): Promise<{ orderId: string }> {
  const { orderId, placed } = await withCurrentStore((ctx) => saveOrder(ctx, input));

  revalidatePath("/orders");
  // Draft items feed the Purchase Queue too (there's no placed_at gate on
  // it), and a resumed-draft save reconciles the pending set — so refresh
  // those views on every save, not only when placing.
  revalidatePath("/purchase-queue");
  revalidatePath("/parcels");
  if (placed) redirect(`/orders/${orderId}`);
  return { orderId };
}

/** Deletes a draft order (see deleteDraft — pending/cancelled items only). */
export async function deleteDraftAction(orderId: string): Promise<void> {
  await withCurrentStore((ctx) => deleteDraft(ctx, { orderId }));
  revalidatePath("/orders");
  revalidatePath("/purchase-queue");
  revalidatePath("/parcels");
  redirect("/orders");
}

/**
 * An Order is closed to new Items once it is placed. Items are added only
 * while the order is still being built in the wizard (saveOrder, which
 * inserts the whole cart in one transaction) — there is no "add another item
 * to an existing order" path. An extra product a Customer asks for after the
 * fact is a new Order, which keeps each Order a faithful record of one
 * request rather than something that quietly grows after Purchasing has
 * already acted on it.
 */
export async function cancelOrderItemAction(formData: FormData) {
  const orderItemId = String(formData.get("orderItemId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  await withCurrentOrganization((ctx) => cancelOrderItem(ctx, { orderItemId, reason }));

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/purchase-queue");
  revalidatePath("/parcels");
}
