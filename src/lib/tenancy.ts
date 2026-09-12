import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withOrganizationScope, type Db } from "@/db/client";

type OrganizationContext = { organizationId: string; storeId: string | null; userId: string; tx: Db };
type StoreContext = OrganizationContext & { storeId: string };

/**
 * Resolves the current session to its organization and runs `fn` with an
 * organization-scoped db handle (see docs/DATA_MODEL.md §5). This is the
 * one function feature code should call to touch tenant-scoped tables —
 * it's what makes "every tenant-scoped query is scoped" a habit instead of
 * something to remember per query.
 *
 * `ctx.storeId` rides along but is NOT re-validated by this wrapper the way
 * organizationId effectively is (via RLS) — Store is a tag, not a tenant
 * boundary (see db/schema.ts's `stores` comment), and can be null. Callers
 * that touch Store-scoped tables (Orders, Order Items) want withCurrentStore
 * below instead, which guarantees a non-null one. Customers moved off this
 * list in ADR-0005 Phase 2 — they're Organization-wide now, like Products.
 *
 * Redirects to /login if there's no session (via requireUser()).
 */
export async function withCurrentOrganization<T>(
  fn: (ctx: OrganizationContext) => Promise<T>,
): Promise<T> {
  const user = await requireUser();
  return withOrganizationScope(user.organizationId, (tx) =>
    fn({ organizationId: user.organizationId, storeId: user.storeId, userId: user.id, tx }),
  );
}

/**
 * Same as withCurrentOrganization, for the Store-scoped tables (Orders,
 * Order Items, Customers) that cannot proceed without one.
 *
 * Redirects to /select-store rather than throwing: reaching here with no
 * active Store means the (dashboard) layout's own gate somehow didn't fire
 * (a race, a direct Server Action call) — the recovery is the same either
 * way, send the member to pick one.
 */
export async function withCurrentStore<T>(fn: (ctx: StoreContext) => Promise<T>): Promise<T> {
  return withCurrentOrganization((ctx) => {
    if (!ctx.storeId) redirect("/select-store");
    return fn({ ...ctx, storeId: ctx.storeId });
  });
}
