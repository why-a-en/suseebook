import Link from "next/link";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { requireUser, roleLabel, type AppRole } from "@/lib/auth";
import { withCurrentOrganization } from "@/lib/tenancy";
import { orders, orderItems, customers, products } from "@/db/schema";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { StatTile } from "@/components/ui/stat-tile";
import { SectionHeader } from "@/components/ui/section-header";
import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/icon";

interface Shortcut {
  href: string;
  label: string;
  icon: IconName;
}

// Admin's set is the union of the other two: the role is a superset, so an
// admin who also logs orders needs one account, not two.
//
// A role's own tab-bar destinations stay out of its shortcuts — repeating a
// tab here is just the same place twice, one tap further away. That rules
// out Settings for both roles, and Orders for Support Agents (see
// (dashboard)/layout.tsx's NAV_BY_ROLE). Supplier still gets Orders, as
// "History": it isn't a tab for them, and it's a different job from their
// own Purchase Queue.
const SHORTCUTS_BY_ROLE: Record<AppRole, Shortcut[]> = {
  admin: [
    { href: "/admin/staff", label: "Staff", icon: "user-plus" },
    { href: "/purchase-queue", label: "To Purchase", icon: "shopping-cart" },
    { href: "/parcels", label: "Parcels", icon: "box" },
    { href: "/customers", label: "Customers", icon: "users" },
    { href: "/products", label: "Products", icon: "package" },
    { href: "/unsourced", label: "Unsourced", icon: "triangle-alert" },
  ],
  support_agent: [
    { href: "/parcels", label: "Parcels", icon: "box" },
    { href: "/customers", label: "Customers", icon: "users" },
    { href: "/products", label: "Products", icon: "package" },
    { href: "/unsourced", label: "Unsourced", icon: "triangle-alert" },
  ],
  supplier: [
    { href: "/purchase-queue", label: "To Purchase", icon: "shopping-cart" },
    { href: "/orders", label: "History", icon: "history" },
    { href: "/customers", label: "Customers", icon: "users" },
    { href: "/products", label: "Products", icon: "package" },
    { href: "/unsourced", label: "Unsourced", icon: "triangle-alert" },
  ],
};

// The tab bar only has room for each role's two highest-frequency tasks
// (see (dashboard)/layout.tsx) — small phones can't take 5 tap targets in
// one bar. Home is the hub everything else hangs off, reached via the
// raised center tab: for supplier it's the only remaining path to
// Settings/sign-out, not just a nice-to-have shortcuts page.
function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface HomeData {
  ordersToday: number;
  draftTotal: number;
  draftPreview: { id: string; customerName: string; itemCount: number }[];
  purchaseTotal: number;
  purchasePreview: { productId: string; productName: string; totalQuantity: number; orderCount: number }[];
}

export default async function HomePage() {
  const user = await requireUser();
  const shortcuts = SHORTCUTS_BY_ROLE[user.role];
  // Capabilities, not role equality: admin gets both panels because its
  // access is a superset of the other two roles.
  const seesDrafts = user.role === "support_agent" || user.role === "admin";
  const seesPurchaseQueue = user.role === "supplier" || user.role === "admin";

  // "Today" (and the greeting below) is server-local time — there's no
  // per-org timezone on the schema yet (see db/schema.ts's orders table), so
  // this matches wherever the app is deployed rather than the store's actual
  // timezone. Good enough for a single-org app; worth a real org.timezone
  // column if that changes.
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Preview cap for the bottom-of-page list — the full count still comes
  // through untouched (draftTotal / purchaseTotal), this only bounds how
  // many rows render before "See all".
  const PREVIEW_CAP = 5;

  const { ordersToday, draftTotal, draftPreview, purchaseTotal, purchasePreview } = await withCurrentOrganization(
    async ({ organizationId, tx }): Promise<HomeData> => {
      const rows = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.organizationId, organizationId), gte(orders.placedAt, startOfToday)));
      const ordersToday = rows.length;

      // Pending Order Items grouped by product (same shape as
      // purchase-queue/page.tsx, just without the per-customer breakdown or
      // images this preview doesn't need) — computed for both roles now:
      // Support sees the count as a heads-up on what's backing up in
      // Purchasing, Supplier sees the same count as their own to-do total
      // and, only for them, the actual ranked list below.
      const pendingRows = await tx
        .select({ productId: orderItems.productId, productName: products.name, orderId: orderItems.orderId, quantity: orderItems.quantity })
        .from(orderItems)
        .innerJoin(products, eq(products.id, orderItems.productId))
        .where(and(eq(orderItems.organizationId, organizationId), eq(orderItems.status, "pending")));

      const byProduct = new Map<string, { productId: string; productName: string; totalQuantity: number; orderIds: Set<string> }>();
      for (const r of pendingRows) {
        let group = byProduct.get(r.productId);
        if (!group) {
          group = { productId: r.productId, productName: r.productName, totalQuantity: 0, orderIds: new Set() };
          byProduct.set(r.productId, group);
        }
        group.totalQuantity += r.quantity;
        group.orderIds.add(r.orderId);
      }
      const groups = Array.from(byProduct.values())
        .map((g) => ({ productId: g.productId, productName: g.productName, totalQuantity: g.totalQuantity, orderCount: g.orderIds.size }))
        .sort((a, b) => b.totalQuantity - a.totalQuantity);
      const purchaseTotal = groups.length;
      const purchasePreview = seesPurchaseQueue ? groups.slice(0, PREVIEW_CAP) : [];

      // Drafts aren't a "today" thing — one could sit unfinished for days —
      // and only Support ever creates or resumes one (Supplier never sees
      // the wizard that makes one, see (dashboard)/layout.tsx's canCreate
      // gate), so only they get the list below (and the count is 0, not
      // fetched, for anyone else).
      if (!seesDrafts) return { ordersToday, draftTotal: 0, draftPreview: [], purchaseTotal, purchasePreview };

      const draftRows = await tx
        .select({ id: orders.id, customerName: customers.name })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(and(eq(orders.organizationId, organizationId), isNull(orders.placedAt)))
        .orderBy(desc(orders.createdAt));

      const previewIds = draftRows.slice(0, PREVIEW_CAP).map((d) => d.id);
      const itemRows =
        previewIds.length === 0 ? [] : await tx.select({ orderId: orderItems.orderId }).from(orderItems).where(inArray(orderItems.orderId, previewIds));
      const itemCountById = new Map<string, number>();
      for (const r of itemRows) itemCountById.set(r.orderId, (itemCountById.get(r.orderId) ?? 0) + 1);

      return {
        ordersToday,
        draftTotal: draftRows.length,
        draftPreview: draftRows.slice(0, PREVIEW_CAP).map((d) => ({ id: d.id, customerName: d.customerName, itemCount: itemCountById.get(d.id) ?? 0 })),
        purchaseTotal,
        purchasePreview,
      };
    },
  );

  return (
    <Screen>
      <TopBar brand title="Home" eyebrow={roleLabel(user.role)} />
      <ScrollBody>
        <div className="px-5 pt-4">
          <div className="font-display text-display-sm tracking-display text-text-strong">
            {greeting(now.getHours())}, {user.name.split(" ")[0]}
          </div>
        </div>

        <div className="flex gap-3 px-5 pt-3">
          <StatTile value={ordersToday} label="Orders today" />
          <StatTile value={purchaseTotal} label="To purchase" />
        </div>

        <SectionHeader>Shortcuts</SectionHeader>
        <div className="grid grid-cols-2 gap-3 px-5 pb-6">
          {shortcuts.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="ds-nav-link flex flex-col items-center justify-center gap-2.5 rounded-md border border-line-hairline bg-surface-card px-3 py-5 text-text-strong shadow-raised"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-surface-raised">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="text-center font-ui text-small-strong">{s.label}</span>
            </Link>
          ))}
        </div>

        {/* A bordered panel holding compact rows — deliberately neither the
            flat full-bleed row list (Orders/Customers) nor the icon-tile
            grid above (Shortcuts): drafts are neither a destination nor a
            record, they're unfinished work waiting on you, so this reads as
            its own module rather than blending into either existing
            pattern. */}
        {seesDrafts ? (
          <>
            <SectionHeader right={draftTotal > 0 ? `${draftTotal} waiting` : undefined}>Draft orders</SectionHeader>
            <div className="mx-5 mb-6 overflow-hidden rounded-md border border-line-hairline bg-surface-card">
              {draftPreview.length === 0 ? (
                <div className="px-4 py-5 text-center font-ui text-small text-text-faint">
                  No drafts waiting — orders you save partway through show up here.
                </div>
              ) : (
                draftPreview.map((d, i) => (
                  <Link
                    key={d.id}
                    href={`/orders/new?draft=${d.id}`}
                    className={
                      "ds-nav-link flex items-center gap-2.5 px-4 py-3 text-text-strong " +
                      (i < draftPreview.length - 1 || draftTotal > draftPreview.length ? "border-b border-line-hairline" : "")
                    }
                  >
                    <Icon name="clock" size={16} color="var(--color-text-faint)" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-ui text-body-strong">{d.customerName}</div>
                      <div className="font-ui text-small text-text-faint">
                        {d.itemCount} item{d.itemCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Badge tone="quiet">Draft</Badge>
                  </Link>
                ))
              )}
              {draftTotal > draftPreview.length ? (
                <Link href="/orders" className="ds-nav-link block px-4 py-2.5 text-center font-ui text-small-strong text-accent-text">
                  See all {draftTotal} drafts
                </Link>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Supplier's equivalent of the draft panel above — same module
            shape (a bordered panel of compact rows, not a destination grid
            or a flat full-bleed list), pending Order Items grouped by
            product instead of unfinished orders, since that's the thing
            actually waiting on a Supplier day to day. */}
        {seesPurchaseQueue ? (
          <>
            <SectionHeader right={purchaseTotal > 0 ? `${purchaseTotal} pending` : undefined}>To purchase</SectionHeader>
            <div className="mx-5 mb-6 overflow-hidden rounded-md border border-line-hairline bg-surface-card">
              {purchasePreview.length === 0 ? (
                <div className="px-4 py-5 text-center font-ui text-small text-text-faint">Nothing pending — new demand from Support shows up here.</div>
              ) : (
                purchasePreview.map((g, i) => (
                  <Link
                    key={g.productId}
                    href="/purchase-queue"
                    className={
                      "ds-nav-link flex items-center gap-2.5 px-4 py-3 text-text-strong " +
                      (i < purchasePreview.length - 1 || purchaseTotal > purchasePreview.length ? "border-b border-line-hairline" : "")
                    }
                  >
                    <Icon name="shopping-cart" size={16} color="var(--color-text-faint)" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-ui text-body-strong">{g.productName}</div>
                      <div className="font-ui text-small text-text-faint">
                        {g.totalQuantity} unit{g.totalQuantity === 1 ? "" : "s"} · {g.orderCount} order{g.orderCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </Link>
                ))
              )}
              {purchaseTotal > purchasePreview.length ? (
                <Link href="/purchase-queue" className="ds-nav-link block px-4 py-2.5 text-center font-ui text-small-strong text-accent-text">
                  See all {purchaseTotal} products
                </Link>
              ) : null}
            </div>
          </>
        ) : null}
      </ScrollBody>
    </Screen>
  );
}
