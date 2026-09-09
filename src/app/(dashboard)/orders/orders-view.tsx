"use client";

import { useState, useTransition } from "react";
import { debounce, useQueryState } from "nuqs";
import { Screen, Toolbar, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { StoreScope, type StoreOption } from "./store-scope";
import { EmptyState } from "@/components/ui/empty-state";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { dateWindowSentence, type DateWindow } from "@/lib/date-range";
import { loadMoreOrdersAction } from "./actions";
import type { OrdersCursor, OrdersFilters } from "./query";

// Order itself carries no status column — status lives on Order Item (see
// docs/adr/0001-order-item-lifecycle-and-packing.md), since one Order can
// span several Items in different stages at once. The one real order-level
// state is whether it's been placed yet (orders.placedAt), so that's what
// this filters by. The list itself shows each order's date rather than a
// Draft/Placed chip — the filter above already answers that question, and
// the per-item summary line answers the more useful one.
type OrderStatus = "draft" | "placed";

const STATUS_SEGMENTS: { value: OrderStatus; label: string }[] = [
  { value: "placed", label: "Placed" },
  { value: "draft", label: "Draft" },
];

// Placed is the default view — the finished orders are what the log is
// mostly for; drafts are the exception you tab to.
const DEFAULT_STATUS: OrderStatus = "placed";

export interface OrderRowData {
  id: string;
  customerName: string;
  /** Preformatted on the server — see formatOrderDate in page.tsx. */
  createdAtLabel: string;
  itemStatuses: string[];
  /** True when the order hasn't been placed yet (placed_at is null) —
   *  tapping the row resumes the wizard (/orders/new?draft=<id>) instead
   *  of opening the detail page. The wizard fetches the resume payload
   *  itself; the list only needs this flag and the item count. */
  isDraft: boolean;
}

function summarize(statuses: string[]): string {
  if (statuses.length === 0) return "no items yet";
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
}

export function OrdersView({
  orders,
  nextCursor,
  filters,
  canCreate,
  window: dateWindow,
  stores,
}: {
  /** The first page, rendered by the route. Later pages are appended below. */
  orders: OrderRowData[];
  nextCursor: OrdersCursor | null;
  /** Exactly what the server filtered by — forwarded verbatim to the
   *  "Load more" action so page 2 can't be filtered differently from page 1. */
  filters: OrdersFilters;
  canCreate: boolean;
  window: DateWindow;
  /** Every Store this member is granted. The Store filter renders only when
   *  there are 2+ — one Store is the whole log. */
  stores: StoreOption[];
}) {
  // `shallow: false` on both, which is the change that made search correct.
  // These used to be client-only filters over whatever the fixed 50-row cap
  // had returned — a customer whose latest order fell outside that window was
  // simply unfindable, and the UI said "No match" rather than admitting it
  // had only looked at part of the table. Now the URL is the query, and both
  // filters run in SQL over every row.
  //
  // `debounce` is what makes that affordable: a keystroke is no longer a free
  // client-side array filter but a server round-trip, so the URL is only
  // written once typing pauses. nuqs keeps the input itself responsive in the
  // meantime — the local value updates immediately, only the navigation waits.
  const [isFiltering, startFiltering] = useTransition();
  const [q, setQ] = useQueryState("q", {
    defaultValue: "",
    shallow: false,
    limitUrlUpdates: debounce(350),
    startTransition: startFiltering,
  });
  const [status, setStatus] = useQueryState<OrderStatus>("status", {
    defaultValue: DEFAULT_STATUS,
    parse: (v): OrderStatus => (v === "draft" ? "draft" : DEFAULT_STATUS),
    serialize: (v) => (v === DEFAULT_STATUS ? "" : v),
    shallow: false,
    startTransition: startFiltering,
  });

  // Pages 2..n. The route re-renders page 1 whenever a filter changes, so
  // these have to be dropped at the same moment or the list would show the
  // new first page followed by the previous filter's tail. Comparing against
  // the filters the server actually used is more reliable than watching the
  // nuqs values, which update before the new page arrives.
  const filterKey = JSON.stringify(filters);
  const [appended, setAppended] = useState<OrderRowData[]>([]);
  const [cursor, setCursor] = useState<OrdersCursor | null>(nextCursor);
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setAppended([]);
    setCursor(nextCursor);
  }

  const [isLoadingMore, startLoadingMore] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startLoadingMore(async () => {
      const page = await loadMoreOrdersAction(filters, cursor);
      setAppended((prev) => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    });
  }

  const rangeLabel = dateWindowSentence(dateWindow);
  const dateFiltered = dateWindow.custom || dateWindow.range !== "all";
  const storeName = stores.find((s) => s.id === filters.storeId)?.name ?? null;

  // No client-side filtering left — every row here already matched in SQL.
  const filtered = [...orders, ...appended];

  return (
    <Screen>
      <TopBar
        brand
        title="Orders"
        // The Store scope (which counter's log this is — scope, not a filter,
        // so it's out of the filter row) for a member who works in 2+ Stores.
        // The list itself carries the count — its "That's all N" footer, and
        // "Load more" when there's more.
        subtitle={stores.length > 1 ? <StoreScope stores={stores} /> : undefined}
        right={
          canCreate ? <IconButton icon="plus" label="New order" href="/orders/new" size="icon-sm" /> : null
        }
      />
      {/* Search and the date trigger share one row — the date control stays
          narrow (icon-only until a window is picked) so search keeps the
          space it needs to be typed into on a phone. */}
      <Toolbar className="pb-2">
        <SearchField
          value={q}
          onChange={(e) => setQ(e.target.value || null)}
          onClear={() => setQ(null)}
          placeholder="Search by customer"
          trailing={<DateRangeFilter window={dateWindow} />}
        />
      </Toolbar>
      <Toolbar className="pt-0">
        <SegmentedControl options={STATUS_SEGMENTS} value={status} onChange={(v) => setStatus(v === DEFAULT_STATUS ? null : v)} />
      </Toolbar>
      {/* The list is the previous filter's result until the server answers.
          Fading it is what distinguishes "no matches" from "not asked yet" —
          without it, a slow query looks like a confident wrong answer, which
          is the exact failure this whole change set out to remove. */}
      <ScrollBody className={isFiltering ? "opacity-55 transition-opacity duration-fast ease-standard" : "transition-opacity duration-fast ease-standard"}>
        {filtered.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={q || dateFiltered || status === "draft" || storeName ? "No match." : "No orders yet."}
            body={
              q
                ? `No orders under that name${rangeLabel ? " " + rangeLabel : ""}.`
                : status === "draft"
                  ? `No draft orders${storeName ? ` at ${storeName}` : ""}${rangeLabel ? " " + rangeLabel : ""}.`
                  : storeName
                    ? `No orders at ${storeName}${rangeLabel ? " " + rangeLabel : ""}.`
                    : rangeLabel
                      ? `No orders ${rangeLabel}.`
                      : "Log the first one from a customer chat."
            }
          />
        ) : (
          filtered.map((order) => (
            <Row key={order.id} href={order.isDraft ? `/orders/new?draft=${order.id}` : `/orders/${order.id}`} className="min-h-[62px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-ui text-body-strong text-text-strong">{order.customerName}</span>
                <span className="mt-0.5 block truncate font-ui text-small text-text-faint">
                  {order.isDraft
                    ? `Draft — ${order.itemStatuses.length} item${order.itemStatuses.length === 1 ? "" : "s"}`
                    : summarize(order.itemStatuses)}
                </span>
              </span>
              {/* When the order was logged, not what state it's in — the
                  per-item statuses already read out in the line above, and a
                  Draft/Placed chip repeated down the whole list said less
                  than the date does. */}
              <time className="shrink-0 font-mono text-label tracking-label uppercase text-text-faint [font-variant-numeric:tabular-nums]">
                {order.createdAtLabel}
              </time>
              <Icon name="chevron-right" size={16} color="var(--color-text-faint)" />
            </Row>
          ))
        )}

        {/* Keyset paging, not page numbers. The log is reverse-chronological
            and new orders land at the top, so OFFSET would shift rows under
            the reader — place an order while someone is deep in the list and
            they'd see a row twice. A cursor is anchored to a row, so it can't
            drift. "Load more" also keeps the scroll position, which numbered
            pages lose and which matters more here than anywhere: this is a
            phone, and the rows are the full width of it. */}
        {cursor ? (
          <div className="px-5 py-4">
            <Button full variant="secondary" icon="chevron-down" disabled={isLoadingMore} onClick={loadMore}>
              {isLoadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : filtered.length > 0 ? (
          <p className="px-5 pt-3 pb-6 text-center font-ui text-small text-text-faint">
            {filtered.length === 1 ? "That's the only order" : `That's all ${filtered.length}`}
            {rangeLabel ? ` ${rangeLabel}` : ""}.
          </p>
        ) : null}
      </ScrollBody>
    </Screen>
  );
}
