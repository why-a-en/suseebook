import { requireUser } from "@/lib/auth";
import { resolveDateWindow } from "@/lib/date-range";
import { fetchOrdersPage, type OrdersFilters } from "./query";
import { OrdersView } from "./orders-view";

// The full Order log (docs/PRD.md §6.2) — separate from the Supplier's
// Purchase Queue and Parcels, which each look at order_items directly rather
// than orders.
//
// All three filters (date, search, status) are applied in SQL, and the list
// is keyset-paginated — see query.ts, which this route and the "Load more"
// Server Action share so the first page and every page after it can't filter
// differently. This file is now just the searchParams → filters translation.
//
// The Customer→Items wizard lives at its own route (see orders/new/page.tsx)
// rather than being fed from here — this page only needs enough per-order
// data to render the list (including each draft's own summary).
type OrdersSearchParams = {
  range?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrdersSearchParams> }) {
  const user = await requireUser();
  const canCreate = user.role !== "supplier";

  const params = await searchParams;
  const dateWindow = resolveDateWindow(params);

  const filters: OrdersFilters = {
    from: dateWindow.from?.toISOString() ?? null,
    to: dateWindow.to?.toISOString() ?? null,
    q: params.q ?? "",
    // Placed is the default — see DEFAULT_STATUS in orders-view.tsx.
    status: params.status === "draft" || params.status === "all" ? params.status : "placed",
  };

  const page = await fetchOrdersPage(filters, null);

  return (
    <OrdersView
      orders={page.rows}
      nextCursor={page.nextCursor}
      total={page.total ?? page.rows.length}
      filters={filters}
      canCreate={canCreate}
      window={dateWindow}
    />
  );
}
