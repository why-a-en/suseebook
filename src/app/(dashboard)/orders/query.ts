import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withCurrentOrganization, withCurrentStore } from "@/lib/tenancy";
import { listMyStores } from "@/services/stores";
import { orders, orderItems, customers } from "@/db/schema";
import type { OrderRowData } from "./orders-view";
import type { WizardCustomer } from "./new-order-wizard";

/** One screenful. Small enough that the two follow-up queries below stay
 *  cheap, large enough that the common case (a day's orders) is one page. */
export const ORDERS_PAGE_SIZE = 30;

/** How many customers the order wizard's picker shows before you type. It
 *  matches the wizard's own browse cap — fetching more than it can display
 *  is just payload. */
export const CUSTOMER_BROWSE_LIMIT = 8;

/** How many a search returns. A picker is for choosing one, not for reading
 *  a report; past this the answer is "type more", not "scroll". */
export const CUSTOMER_SEARCH_LIMIT = 20;

/** Everything that narrows the log. Serialisable on purpose: the first page
 *  is built from searchParams on the server, and every later page comes back
 *  through a Server Action with this exact shape forwarded from the client,
 *  so the two can't drift into filtering differently. */
export interface OrdersFilters {
  /** ISO strings, not Dates — this crosses the Server Action boundary. */
  from: string | null;
  to: string | null;
  q: string;
  status: "draft" | "placed";
  /** One Store to narrow the log to, or null for every Store the caller is
   *  granted. Only settable from the UI by a member with 2+ Store grants;
   *  `fetchOrdersPage` re-checks it against those grants, so a value forwarded
   *  from the client can only ever narrow the sender's own view — never widen
   *  it past what they may see. */
  storeId: string | null;
}

/** Keyset position: the last row of the page just returned.
 *
 *  Both halves are load-bearing. `createdAt` alone is not unique — two orders
 *  placed in the same tick share it — and a cursor on a non-unique column
 *  either skips rows (`<`) or repeats them (`<=`) at exactly the boundary
 *  where a page ends. Pairing it with the primary key makes the sort total,
 *  so every row has exactly one position in it. */
export interface OrdersCursor {
  createdAt: string;
  id: string;
}

export interface OrdersPage {
  rows: OrderRowData[];
  /** Null when this was the last page. Derived by asking for one row more
   *  than a page and seeing whether it arrived — cheaper and more honest
   *  than a COUNT per page, which would have to re-run the whole filter. */
  nextCursor: OrdersCursor | null;
}

/** Formatted here on the server rather than in the client component, so the
 *  two can't disagree: `toLocaleDateString` reads the runtime's locale and
 *  timezone, and letting the browser format an ISO string that the server
 *  already rendered is a textbook hydration mismatch. Same server-local-time
 *  caveat as home/page.tsx's "today" — there's no per-org timezone column
 *  on the schema yet.
 *
 *  This year's orders drop the year (a queue is mostly recent), older ones
 *  keep it so an archived order can't be misread as current. */
function formatOrderDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** `%` and `_` are wildcards to LIKE, so a customer searching for "50%" would
 *  otherwise widen their own search instead of narrowing it. Backslash is
 *  Postgres's default LIKE escape character, which is why it has to be
 *  escaped first — doing it last would double-escape the ones just added. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The first customers the order wizard offers, before anything is typed,
 * plus how many exist in total so the list can say what it is not showing.
 */
export async function fetchCustomerBrowse(): Promise<{ rows: WizardCustomer[]; total: number }> {
  return withCurrentStore(async ({ organizationId, storeId, tx }) => {
    const rows = await tx
      .select({ id: customers.id, name: customers.name, phone: customers.phone, address: customers.address })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.storeId, storeId)))
      .orderBy(asc(customers.name))
      .limit(CUSTOMER_BROWSE_LIMIT);

    const [totalRow] = await tx
      .select({ value: count() })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.storeId, storeId)));

    return { rows, total: totalRow?.value ?? rows.length };
  });
}

/**
 * Customer search for the order wizard's picker.
 *
 * This runs in SQL for the same reason the Order log's does. The wizard used
 * to be handed the first 200 customers and filter them in the browser, so the
 * 201st could not be found from the one screen whose entire job is finding a
 * customer — and the picker said nothing, it just showed no rows. Anyone
 * hitting it would reasonably conclude the customer didn't exist and create a
 * duplicate, which is the worst available outcome for a customer record.
 *
 * Name and phone both match, because the field says "Name or phone".
 */
export async function searchCustomers(query: string): Promise<WizardCustomer[]> {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${escapeLike(q)}%`;

  return withCurrentStore(async ({ organizationId, storeId, tx }) =>
    tx
      .select({ id: customers.id, name: customers.name, phone: customers.phone, address: customers.address })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, organizationId),
          eq(customers.storeId, storeId),
          or(ilike(customers.name, pattern), ilike(customers.phone, pattern)),
        ),
      )
      .orderBy(asc(customers.name))
      .limit(CUSTOMER_SEARCH_LIMIT),
  );
}

/**
 * One page of the Order log, filtered and keyset-paginated.
 *
 * Every filter is applied in SQL. Search and status used to be applied in the
 * browser over whatever the fixed `limit(50)` had returned, which meant
 * searching for a customer whose most recent order fell outside those 50 rows
 * answered "No match" — a wrong answer, delivered with no sign that anything
 * had been left out. Only the date window was ever a server filter, and the
 * comment explaining why (it has to be applied before the cap, or narrowing
 * the window would only ever look inside the newest page) is the same
 * argument for the other two.
 *
 * Scoped to the *Organization*, not one Store: the log spans every Store the
 * member is granted (Store is a tag, not a tenant boundary — see the `stores`
 * comment in db/schema.ts), and `filters.storeId` narrows to one of them. An
 * Admin running two counters can read either log without switching their
 * active Store.
 */
export async function fetchOrdersPage(filters: OrdersFilters, cursor: OrdersCursor | null): Promise<OrdersPage> {
  const q = filters.q.trim();

  return withCurrentOrganization(async ({ organizationId, userId, tx }) => {
    // Every Store this member may work in — suspended ones included, so a
    // Store going dark doesn't also hide its order history. `listMyStores`
    // reads `member_stores` (hand-filtered by userId + org, as it must be),
    // so this set is the ceiling on what the filter below can show.
    const grantedStoreIds = (await listMyStores({ organizationId, storeId: null, userId, tx })).map(
      (s) => s.id,
    );
    // Unreachable through normal navigation — the (dashboard) layout's own
    // gate sends a member with no Store to /select-store first — but a direct
    // Server Action call could land here. Same recovery.
    if (grantedStoreIds.length === 0) redirect("/select-store");

    // A `storeId` outside the grant set is ignored, not honoured — it falls
    // back to "every granted Store" rather than showing nothing or erroring.
    const storeIds =
      filters.storeId && grantedStoreIds.includes(filters.storeId)
        ? [filters.storeId]
        : grantedStoreIds;
    const storeScope =
      storeIds.length === 1 ? eq(orders.storeId, storeIds[0]) : inArray(orders.storeId, storeIds);

    // Shared by the page query and the COUNT below, so the two can't filter
    // differently. The cursor comparison is page-only and stays out of here.
    const scope = and(
      eq(orders.organizationId, organizationId),
      storeScope,
      ...(filters.from ? [gte(orders.createdAt, new Date(filters.from))] : []),
      ...(filters.to ? [lte(orders.createdAt, new Date(filters.to))] : []),
      filters.status === "draft" ? isNull(orders.placedAt) : isNotNull(orders.placedAt),
      ...(q ? [ilike(customers.name, `%${escapeLike(q)}%`)] : []),
    );

    const where = and(
      scope,
      // Row-wise comparison rather than the expanded
      // `createdAt < x OR (createdAt = x AND id < y)`: they mean the same
      // thing, but Postgres can drive the composite index directly from this
      // form, and it can't always from the expanded one.
      ...(cursor
        ? [sql`(${orders.createdAt}, ${orders.id}) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id}::uuid)`]
        : []),
    );

    const orderRows = await tx
      .select({
        id: orders.id,
        customerId: orders.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerAddress: customers.address,
        notes: orders.notes,
        createdAt: orders.createdAt,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      // One more than a page: its presence is what says "there is a next
      // page", and it's discarded below rather than shown.
      .limit(ORDERS_PAGE_SIZE + 1);

    const hasMore = orderRows.length > ORDERS_PAGE_SIZE;
    const pageRows = hasMore ? orderRows.slice(0, ORDERS_PAGE_SIZE) : orderRows;

    const orderIds = pageRows.map((o) => o.id);
    // The list needs only each order's item statuses (for the summary line,
    // and its length as the draft count) — not products or modifier
    // selections. The wizard fetches a draft's full contents itself.
    const itemRows =
      orderIds.length === 0
        ? []
        : await tx
            .select({ orderId: orderItems.orderId, status: orderItems.status })
            .from(orderItems)
            .where(inArray(orderItems.orderId, orderIds));

    const statusesByOrder = new Map<string, string[]>();
    for (const row of itemRows) {
      const statuses = statusesByOrder.get(row.orderId) ?? [];
      statuses.push(row.status);
      statusesByOrder.set(row.orderId, statuses);
    }

    const rows = pageRows.map(
      (order): OrderRowData => ({
        id: order.id,
        customerName: order.customerName,
        createdAtLabel: formatOrderDate(order.createdAt),
        itemStatuses: statusesByOrder.get(order.id) ?? [],
        isDraft: order.placedAt === null,
      }),
    );

    const last = pageRows.at(-1);
    return {
      rows,
      nextCursor: hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
    };
  });
}
