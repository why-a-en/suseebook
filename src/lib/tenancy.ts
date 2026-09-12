import { requireUser } from "@/lib/auth";
import { withOrganizationScope, type Db } from "@/db/client";

type OrganizationContext = { organizationId: string; userId: string; tx: Db };

/**
 * Resolves the current session to its organization and runs `fn` with an
 * organization-scoped db handle (see docs/DATA_MODEL.md §5). This is the
 * one function feature code should call to touch tenant-scoped tables —
 * it's what makes "every tenant-scoped query is scoped" a habit instead of
 * something to remember per query.
 *
 * There used to be a `withCurrentStore` alongside this, for a `storeId` that
 * rode on `ctx` but was NOT re-validated by RLS the way organizationId is —
 * Store was a tag, not a tenant boundary. ADR-0005 Phase 3 collapsed that
 * distinction: organizationId *is* the Store now, so every caller just
 * wants this.
 *
 * Redirects to /login if there's no session (via requireUser()).
 */
export async function withCurrentOrganization<T>(
  fn: (ctx: OrganizationContext) => Promise<T>,
): Promise<T> {
  const user = await requireUser();
  return withOrganizationScope(user.organizationId, (tx) =>
    fn({ organizationId: user.organizationId, userId: user.id, tx }),
  );
}
