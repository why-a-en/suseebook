# Store as sole tenant — migration & build sequence

**Status:** Ready for review — nothing executed
**Last updated:** 2026-09-10
**Executes:** [ADR-0005](../adr/0005-store-as-sole-tenant.md)
**Supersedes work:** the cross-Store Orders-log filter (`feat/orders-store-filter`) is partly reverted in Phase 3.

## Risk posture

The database holds **seed data only** — no external tenant has been
onboarded (per [better-auth-migration.md §1](./better-auth-migration.md),
still true as of 2026-09-10). Worst-case recovery for every phase is
re-running `scripts/seed-test-data.mts` against a fresh Neon branch. No
maintenance window, nobody to notify.

The one thing that must not regress: **RLS on `app.organization_id`**. No
phase touches the policy bodies, the GUC, or the `app_user` role. Phase 3
only *drops* columns and tables that sit beside the boundary, never the
boundary itself.

## Phasing

Phases 1 and 2 are independently shippable and de-risk the big one. Phase 3
is the collapse. Phase 4 is provisioning polish. Do them in order.

---

## Phase 1 — Invitations (the unblocker)

Still under the current Organization model. Delivers the accept flow that
Phase 3 depends on, and is useful on its own.

**Schema**
- No new tables — `invitations` already exists (better-auth shape:
  `id, organizationId, email, role, status, inviterId, expiresAt`).
- Confirm `status` values and `expiresAt` default via the plugin config.

**Server**
- Accept flow on top of the better-auth organization plugin
  (`auth.api.createInvitation`, `auth.api.acceptInvitation`,
  `auth.api.rejectInvitation`).
- Email delivery for the invite link (token in the URL, `expiresAt`
  enforced). Pick the transport (Resend / SES / console-log in dev) — small
  ADR if it carries lock-in.
- `/invite/accept?token=…` route:
  - **new email** → form: name + password → creates `users` + `accounts` +
    `members`, flips `invitations.status` to `accepted`, signs them in.
  - **known email** → one confirm button → creates `members` only.
- `services/staff.ts::addStaff` → send an invitation instead of minting a
  temp-password account. `must_change_password` is no longer set here (keep
  the column and the forced-change flow for `resetStaffPassword`).

**UI**
- `/admin/staff` "Add staff": email + role (+ Store, still, at this phase) →
  "Invitation sent".
- Pending-invitation list on the staff screen (resend / revoke).
- Platform console: "Invite Admin to &lt;Organization&gt;".

**Tests**
- Accept-new, accept-known, expired-token, already-accepted, wrong-email.

**Ships as:** invitations replace temp passwords. No model change yet.

---

## Phase 2 — Customers become tenant-wide

Self-contained. Customers stop being Store-scoped and become visible across
the (current) Organization — a safe widening.

**Migration** (`NNNN_customers_org_wide.sql`)
```sql
DROP INDEX customers_organization_store_name_idx;
ALTER TABLE customers DROP COLUMN store_id;
CREATE INDEX customers_organization_name_idx ON customers (organization_id, name);
```

**Code**
- `orders/query.ts`: `searchCustomers`, `fetchCustomerBrowse` — drop the
  `eq(customers.storeId, …)` clause.
- `orders/actions.ts` / `services/customers.ts`: `createCustomer` — stop
  stamping `storeId`; `ctx` no longer needs a resolved Store for this.
- `new-order-wizard.tsx`: customer picker no longer implies a Store.
- `db/schema.ts`: drop `customers.storeId` + reindex.
- Fixtures in `tests/**`: drop `storeId` from customer inserts.

**Tests**
- A customer created "at" one Store is found from another (once Phase 3
  makes that meaningful; here just assert the query has no Store term).
- `tenant-isolation.test.ts`: customer still walled at the Organization.

**Ships as:** one customer record per person per tenant, matching Products.

---

## Phase 3 — The collapse

Delete the sub-Store layer. This is the ADR's core.

### 3a. Migration (`NNNN_store_as_tenant.sql`)

**Pre-check:** `SELECT organization_id, count(*) FROM stores GROUP BY 1
HAVING count(*) > 1;` — any Organization with 2+ Stores needs a manual
call (merge vs. split into two tenants) *before* this runs. Expected: none.

```sql
-- orders / order_items: store_id is now redundant with organization_id
DROP INDEX orders_organization_store_created_idx;
DROP INDEX order_items_org_store_product_status_idx;
DROP INDEX order_items_org_store_status_created_idx;
ALTER TABLE orders       DROP COLUMN store_id;
ALTER TABLE order_items  DROP COLUMN store_id;
CREATE INDEX orders_organization_created_idx
  ON orders (organization_id, created_at, id);           -- already added in 0012; keep
CREATE INDEX order_items_org_product_status_idx
  ON order_items (organization_id, product_id, status);   -- Purchase Queue
CREATE INDEX order_items_org_status_created_idx
  ON order_items (organization_id, status, created_at);   -- Packing Queue

-- session no longer carries a separate active Store
ALTER TABLE sessions DROP COLUMN active_store_id;

-- the sub-level tables
DROP TABLE member_stores;
DROP TABLE stores;
```

No RLS policy changes. `organization_id` is the tenant id and stays exactly
as it is.

### 3b. Auth / scoping

- `src/lib/tenancy.ts`: delete `withCurrentStore`. Callers use
  `withCurrentOrganization`. `ServiceContext` drops `storeId`.
- `src/lib/auth/`: delete `resolveActiveStoreId`, `setActiveStore`. The
  session's `activeOrganizationId` (better-auth) is the active Store;
  `getCurrentUser()` resolves role from the `members` row for that
  organization. Drop the `member_stores` re-validation.
- `src/db/client.ts`: no change (still sets `app.organization_id`).

### 3c. Services

- **Delete `src/services/stores.ts`** (`listStores`, `listMyStores`,
  `createStore`, `setStoreStatus`, `grantStoreAccess`).
- `src/services/orders.ts::saveOrder`: `ctx.storeId` → `ctx.organizationId`;
  `order_items` insert drops `storeId`. The Phase-just-before empty-cart →
  draft guard is untouched.
- `src/services/customers.ts`, `src/services/staff.ts`: drop Store grants.
  `addStaff` = invite (from Phase 1), no Store to pick now.

### 3d. Routes / UI

- Delete `/select-store` (route + `select-store-list.tsx` + `actions.ts`).
- Delete Settings `StoreSwitcher` + `switchStoreAction`. The existing
  `OrganizationSwitcher` **is** the Store switcher — relabel it, keep the
  behaviour (it already re-stamps `activeOrganizationId`).
- `(dashboard)/layout.tsx`: drop the `/select-store` gate and the
  "Organization has no Store → /onboarding" gate. Keep the
  `must_change_password` gate.
- `/onboarding`: for the *invited Admin*, there's no Store to create
  (Platform Admin made it). Onboarding becomes "set your password, you're
  in" — mostly folds into the Phase 1 accept flow.
- **Orders log — revert the cross-Store work:**
  - `orders/page.tsx`: drop `listMyStores`, the `?store=` param, the
    `stores` prop.
  - `orders/query.ts::fetchOrdersPage`: back to single-tenant scope — no
    `storeId` filter, no granted-store set, `withCurrentOrganization`.
  - `orders/orders-view.tsx`: drop the `StoreScope` subtitle. The TopBar
    shows the Store name (from the active-org context) as a plain,
    non-interactive subtitle, or nothing.
  - **Delete `orders/store-scope.tsx`.**
  - Keep: the "All" tab removal, the empty-cart guard, the dropped header
    count — all orthogonal.
- Platform console: "Create Organization" → "Create Store"; wire the
  "invite first Admin" step (Phase 4 makes it one flow).

### 3e. Scripts

- `scripts/create-organization.mts` → `scripts/store-create.mts` (rename the
  npm script `org:create` → `store:create`). Still bootstraps a Store + its
  first Admin from the CLI; `/platform` is the in-app equivalent.
- `scripts/add-membership.mts` → drop `--stores`; it's `(email, store,
  role)` now, or just send an invite.
- `scripts/seed-test-data.mts` → rewrite: Stores instead of Orgs+Stores,
  memberships instead of `member_stores`.

### 3f. Docs

- `CONTEXT.md`: **Organization** entry → removed / folded; **Store** entry
  rewritten as the tenant; add **Invitation**; adjust **Admin**,
  **Product**, **Modifier** wording ("Organization-wide" → "Store-wide").
- `DATA_MODEL.md`: §1 ER diagram, §3 (`organizations`/`stores`/`member_stores`
  entries), §4 (denormalization rationale — now trivially "the tenant id"),
  §5 (unchanged, add a line that `organization_id` == Store).
- `TECH_STACK.md §4`: the multi-tenancy section — one boundary, note the
  `organization_id` == Store naming.
- `docs/adr/0004-*.md`: add `status: superseded by ADR-0005` frontmatter.

### 3g. Tests

- `tenant-isolation.test.ts`: fixtures drop `stores` + `member_stores`;
  intent unchanged.
- `orders.test.ts`, `staff.test.ts`: drop Store setup; `asOrg` is the only
  scoping helper.
- Add: an invite to Store B for a user who's a member of Store A →
  they see B's data only when B is active, A's only when A is active.

**Ships as:** one tenant concept end to end.

---

## Phase 4 — Provisioning polish

- `/platform`: "Create Store" and "Invite first Admin" as a single guided
  flow (name the Store → enter the Admin's email → done).
- Invited-Admin first-run: accept → straight into their Store. No
  Store-creation step, no Organization concept surfaced anywhere.
- Pending-invite management for Platform Admins (resend / revoke Admin
  invites).

---

## Deferred (not in this plan)

- Cosmetic DB rename `organization_id` → `store_id` (ADR-0005 §2).
- Multi-Store owner analytics rollup — ownership mapping + reporting surface
  (ADR-0005 §9).
- "Copy catalog to another Store" (ADR-0005 §10).
- Per-membership `display_name` (ADR-0005 §5).

## Open questions

1. **Email transport** for invitations — Resend, SES, something else?
   Carries lock-in → its own short ADR.
2. **Invite expiry window** — 7 days? Resend regenerates the token?
3. **Known-email invite privacy** — when Store B's Admin invites an email
   that already has an account, does the Admin see the existing name to
   confirm identity, or just "invitation sent"? Leaning: "sent", the person
   confirms on their side.
4. Any **live tenant with 2+ Stores** today (Phase 3a pre-check)? If yes,
   merge or split — decide before running 3a.
