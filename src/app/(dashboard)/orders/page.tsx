import { requireUser } from "@/lib/auth";
import { withCurrentOrganization } from "@/lib/tenancy";
import { listMyStores } from "@/services/stores";
import { resolveDateWindow } from "@/lib/date-range";
import { fetchOrdersPage, type OrdersFilters } from "./query";
import { OrdersView } from "./orders-view";

// The full Order log (docs/PRD.md §6.2) — separate from the Supplier's
// Purchase Queue and Parcels, which each look at order_items directly rather
// than orders.
//
// All four filters (date, search, status, store) are applied in SQL, and the
// list is keyset-paginated — see query.ts, which this route and the "Load
// more" Server Action share so the first page and every page after it can't
// filter differently. This file is now just the searchParams → filters
// translation.
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
  store?: string;
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrdersSearchParams> }) {
  const user = await requireUser();
  const canCreate = user.role !== "supplier";

  const params = await searchParams;
  const dateWindow = resolveDateWindow(params);

  // Every Store this member is granted. The log spans all of them; the Store
  // filter (shown only when there are 2+) narrows to one. Resolved here so
  // `?store=` is validated on the server — an id that isn't a real grant is
  // dropped rather than trusted, and query.ts re-checks it besides.
  const myStores = await withCurrentOrganization((ctx) => listMyStores(ctx));
  const storeId = myStores.some((s) => s.id === params.store) ? params.store! : null;

  const filters: OrdersFilters = {
    from: dateWindow.from?.toISOString() ?? null,
    to: dateWindow.to?.toISOString() ?? null,
    q: params.q ?? "",
    // Placed is the default — see DEFAULT_STATUS in orders-view.tsx.
    status: params.status === "draft" ? "draft" : "placed",
    storeId,
  };

  const page = await fetchOrdersPage(filters, null);

  return (
    <OrdersView
      orders={page.rows}
      nextCursor={page.nextCursor}
      filters={filters}
      canCreate={canCreate}
      window={dateWindow}
      stores={myStores.map((s) => ({ id: s.id, name: s.name, status: s.status }))}
    />
  );
}
