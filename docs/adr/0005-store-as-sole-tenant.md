---
status: accepted
supersedes: ADR-0004
amends: ADR-0002 (§6 onboarding, §10 provisioning), ADR-0003 (temp-password path for new staff)
---

# Store as the sole tenant: no Organization layer, platform-provisioned, invitation-based membership

[ADR-0002](./0002-multi-tenancy-mvp.md) made the **Organization** the tenant
and [ADR-0004](./0004-stores-within-an-organization.md) added **Store** as a
scope tag one level below it — deliberately *not* a second RLS boundary,
because two Stores were "one business with one staff pool."

That framing no longer matches the product. The platform onboards
individual shopfronts, curated one at a time. A person who runs two of them
is the exception, and treating their two Stores as one pooled business —
shared catalog, shared customers, shared staff, cross-Store reporting — is
machinery nobody asked for, paid for on every Store.

So: **collapse the two levels into one. The Store is the tenant.** There is
no Organization.

## The problem that forces this

Three things pushed against the two-level model at once:

1. **Provisioning changed.** Stores are now created by a **Platform Admin**,
   who invites the Store's first **Admin**. There is no self-serve signup and
   no `/onboarding` step where an Admin creates their own first Store. The
   Organization was the thing a signup created; without signup it has no
   birth event of its own.

2. **The shared-business premise dissolved.** ADR-0004 §1 rested on Stores
   being non-adversarial counters of one shop. The real unit is one
   shopfront with its own catalog, its own customers, its own staff. Two
   Stores under one owner are two businesses that happen to share a person,
   exactly the way two Organizations already do for a shared Supplier
   (ADR-0002).

3. **We were about to bolt RLS onto `store_id`** to make it a real boundary
   after all (a draft ADR-0005, now this one). Adding a *second* enforced
   scope below the first — a second GUC, a role-aware fail-closed policy on
   `orders`/`order_items`, a cross-Store escape hatch for Admins — is a lot
   of surface. Removing the *first* one and keeping the second's job on the
   boundary that already works is simpler and lands in the same place.

The database holds seed data only (per
[better-auth-migration.md §1](../plans/better-auth-migration.md), confirmed
still true), so this is close to risk-free to do now and expensive to defer.

## The shape of the decision

The tenant machinery from ADR-0002 does not move. `organization_id` stays on
every tenant-scoped table, RLS stays keyed on `app.organization_id`, the
non-`BYPASSRLS` `app_user` role stays. What changes is **what a row in that
table means**: it is a **Store**, not an Organization. The `stores` and
`member_stores` tables — the sub-level — are deleted.

`members` becomes the Store's team directly: `(user, store, role)`, one row
per person per Store. `invitations` — the better-auth table that has existed
empty since ADR-0002 — is finally built out and is the only way anyone
joins a Store.

## Decisions

**1. The Store is the tenant; there is no Organization.** One RLS boundary,
one active-scope-per-session, one membership relation. A Store is a single
shopfront: its catalog (Products, Modifiers, Options, Images), its Customers,
its Orders and Order Items, and its staff all belong to exactly one Store and
are invisible to every other.

**2. The database keeps the name `organization_id`; the domain calls it
Store.** Renaming the tenant column across ten tables, every RLS policy body,
the `app.organization_id` GUC, and the `app_user` role setup would be a
mechanical change with real blast radius against the one part of the system
that must never break — for a cosmetic gain. The better-auth organization
plugin also pins `session.activeOrganizationId` and its own table shapes.
So: `organization_id` **is** the Store id, `app.organization_id` **is** the
active Store, and `CONTEXT.md` / `DATA_MODEL.md` say so plainly. A later
cosmetic-rename ADR is possible; it is explicitly not part of this one.

**3. The better-auth organization plugin's "organization" is the Store.**
`members`, `invitations`, `activeOrganizationId` on the session, the org
switcher in Settings — all reused as-is, relabelled. `member_stores`,
`sessions.active_store_id`, `withCurrentStore`, `resolveActiveStoreId`,
`setActiveStore`, `/select-store`, and `services/stores.ts` are deleted.
`withCurrentOrganization` is the one scoping wrapper.

**4. Membership is per-Store, and so is role.** A user with three `members`
rows is a member of three Stores. `members.role`
(`admin | support_agent | supplier`) is resolved from the **active Store's**
row on every request — the same person can be `admin` at one Store and
`support_agent` at another. This is ADR-0002's identity/membership split
unchanged; only the thing membership points at is now a Store.

**5. `users.email` is the global identity. No Store owns a person.** One
email is one `users` row is one login, forever. Adding a known email to a
second Store creates a `members` row and nothing else — no new account, no
new password, and **the inviter does not set a name**. `users.name` and the
password are owned by the person: set once when they accept their first
invitation, editable only by them. A Store that needs its own label for
someone would use a per-membership `display_name` — deferred (Decision 11).
Two real people sharing one inbox are one account here; acceptable for a
staff tool, unchanged from today.

**6. Joining a Store is always an invitation.** Two flows, same mechanics:

   - **Platform Admin → Store's first Admin.** The Platform Admin creates the
     Store and sends one `invitations` row (`role = 'admin'`).
   - **Store Admin → team member.** Scoped to the Admin's active Store;
     `role` is `support_agent`, `supplier`, or another `admin`.

   Accepting: if the email is new, the person sets their name + password
   (`users` + `accounts` + `members` created); if the email is known, one
   click adds the `members` row. The pending `invitations` row flips to
   `accepted`. This **retires the admin-sets-a-temporary-password path** for
   new staff (ADR-0003's `must_change_password` stays only for an Admin
   *resetting* an existing colleague's password).

**7. The minimal rows to add anyone to any Store** are **one `invitations`
row, then one `members` row** — plus `users` + `accounts` only when the
email is new to the platform. "Staff" versus "Admin" is the `role` column on
that single `members` row; there is no role-specific table.

**8. An Admin sees only their own Store.** No cross-Store view, no "all
stores" filter. A multi-Store Admin switches active Store (the Settings
switcher) to work each one — reads and writes both follow the active Store's
tenant scope. This reverts the cross-Store order-log filter added just
before this ADR.

**9. Cross-Store reporting is a Platform-Admin concern only.** The
`/platform` console already reads across every tenant. A tenant Admin who
runs several Stores does **not** get a rollup. If consolidated analytics for
multi-Store owners ever becomes real, it gets a thin ownership mapping
(`store` → owner) and a dedicated read surface — additive, built then, not
now (Decision 12).

**10. Catalog and Customers are Store-scoped, because Store is the tenant.**
There is no org-wide anything anymore. A merchant with two Stores maintains
two catalogs and two customer lists. "Copy a catalog to another Store" is a
plausible future convenience; it is not a boundary.

## Considered and rejected

- **Keep Organization, just stop self-serve provisioning and relabel it
  "Store".** The right call *if* multi-Store owners need a rollup — a shared
  catalog, consolidated billing, one identity spanning Stores, inventory
  transfers. They don't (Decision 9): the need is reporting, and reporting
  doesn't need a shared boundary. Keeping Organization to preserve the
  *option* taxes every query, policy, and migration on 100% of the product
  for a &lt;5% maybe.

- **Bolt RLS onto `store_id` and keep Organization above it** (the draft this
  ADR replaces). A second enforced scope below the first: `app.store_id` GUC,
  a fail-closed `USING` policy with a role-gated `cross_store` bypass, a
  stricter `WITH CHECK` so the bypass stays read-only. Coherent, and it
  correctly made creation always stamp the active Store. But it is strictly
  more machinery than removing the layer above and letting the existing
  boundary do the job.

- **Rename `organization_id` → `store_id` everywhere now.** Pure churn
  against the RLS layer for a cosmetic end state the better-auth plugin
  can't fully deliver anyway (`activeOrganizationId` is the plugin's).
  Deferred as its own optional cleanup.

- **Each Store gets its own better-auth "organization" AND we keep a
  `stores` table joined to it.** Two rows, two ids, one concept — the exact
  redundancy (`orders.organization_id` + `orders.store_id`, always 1:1 after
  the collapse) this ADR removes.

## Deferred, deliberately

- **Per-membership `display_name`** — a Store labelling a shared person its
  own way (Decision 5). Nobody has asked; `users.name` is enough until
  someone does.

- **Multi-Store owner analytics rollup** (Decision 9) — the ownership
  mapping + cross-Store reporting surface. Built when a real multi-Store
  owner needs it, designed against what the analytics actually require.

- **"Copy catalog to another Store"** (Decision 10) — a convenience for the
  merchant opening a second shopfront. Not a boundary decision; a feature.

- **Cosmetic rename `organization_id` → `store_id`** (Decision 2) — possible
  later, on its own, when it is worth a dedicated migration.

- **Editing a member's role after invite** — `changeStaffRole` already
  exists; unaffected. Adding/removing a person's *Stores* after the fact is
  just another invitation / a membership delete — no new screen promised
  here.

## Consequences

**Deleted:** `stores`, `member_stores`, `sessions.active_store_id`,
`orders.store_id`, `order_items.store_id`, `customers.store_id` (and their
indexes); `withCurrentStore`, `resolveActiveStoreId`, `setActiveStore`,
`services/stores.ts`, the `/select-store` route and its gate, the
`StoreSwitcher` component and `switchStoreAction`, the Store-creation step in
`/onboarding`.

**Built:** the `invitations` accept flow (token, email, accept page,
expiry); a Platform-console "Create Store + invite first Admin" flow;
`addStaff` sends an invitation instead of minting a temp-password account.

**Reworked:** `saveOrder` and every Store-scoped query drop the `store_id`
term and scope on the tenant id alone; the Orders log drops its cross-Store
filter and `StoreScope` control (it shows the active Store's name, nothing to
pick); `(dashboard)/layout.tsx` loses the `/select-store` and
`/onboarding`-needs-a-Store gates; `CONTEXT.md`, `DATA_MODEL.md §3` and
`TECH_STACK.md §4` lose the Organization/Store distinction.

**`tests/tenant-isolation.test.ts`** is unchanged in intent — the boundary
it asserts is exactly the one that remains — but every fixture drops its
`stores`/`member_stores` setup.

**ADR-0004 is superseded in full.** ADR-0002's identity/membership split,
suspension model, and impersonation all stand; only its §6 (Organization in
the session — now the Store) and §10 (`org:create` bootstrap — now
`store:create` + invite) are amended. ADR-0003's `must_change_password`
survives for Admin-initiated password *resets* only.

A migration + build sequence is in
[docs/plans/store-as-tenant.md](../plans/store-as-tenant.md).
