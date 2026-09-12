import type { Db } from "@/db/client";

/**
 * The functional role within an Organization. Declared here, on the side of
 * the codebase that has no framework dependency, and re-exported from
 * `src/lib/auth` for feature code — so services and UI cannot drift apart.
 *
 * Unrelated to platform administration; see the note in src/lib/auth.
 */
export type AppRole = "admin" | "support_agent" | "supplier";

/**
 * What every service function needs to do its job: who is asking, which
 * Organization they are acting in, and the transaction to act through.
 *
 * Structurally identical to what `withCurrentOrganization()` yields, so a
 * Server Action can pass its context straight in — but declared here rather
 * than imported from `src/lib/tenancy.ts`, because nothing under
 * `src/services/` may depend on the Next.js side of the app.
 *
 * See docs/ARCHITECTURE_ROADMAP.md §4 (Stage 1) for why this boundary
 * exists: these functions are what an HTTP handler, a background job, or a
 * test would call, and none of those have a request context.
 */
export type ServiceContext = {
  organizationId: string;
  userId: string;
  tx: Db;
};

/** Thrown for a rule the caller broke, as opposed to a bug. */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
