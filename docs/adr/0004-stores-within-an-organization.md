---
status: superseded by ADR-0005
---

# Stores within an Organization: a scope tag, not a second tenant boundary

> **Superseded by [ADR-0005](./0005-store-as-sole-tenant.md).** The
> Organization layer was removed: the Store is now the sole tenant, and
> `stores` / `member_stores` no longer exist. The reasoning below — why a
> second RLS boundary wasn't worth it — still informed 0005's choice to keep
> one boundary rather than add a second.

[ADR-0002](./0002-multi-tenancy-mvp.md) made the Organization the tenant —
absolute isolation, enforced by row-level security. This ADR adds a level
*below* it: an Organization can run more than one **Store**, and every
transactional record belongs to exactly one.

## The problem that forces this

A reseller opens a second counter. Its orders, its customers, its parcels
and its purchase queue are a different day's work from the first counter's,
and staff are often assigned to one or the other. Today everything an
Organization owns is one undifferentiated pool.

## The shape of the decision

`store` is to `organization` what `organization` was to the pre-ADR-0002
single-tenant app — the same machinery generalizes one level down:

- a denormalized scope column (`store_id`) on the transactional tables
- the active scope carried on the session (`sessions.active_store_id`)
- a switcher in Settings
- grants on the membership (`member_stores`)

What is **deliberately not** carried down is the RLS boundary.

## Decisions

**1. Store is a tag, not a wall.** `store_id` gets no RLS policy and no
`app.store_id` session variable. Two Stores are one business with one staff
pool; an Admin routinely needs to see and manage both, and cross-store
reporting is a first-class need, not an escape hatch. RLS defends against an
*adversarial* boundary — another company's bug or bad actor — and that does
not exist between your own two counters. So `store_id` is an ordinary
`WHERE` clause the app adds explicitly (`withCurrentStore` threads it into
every Store-scoped query), plus the index locality the Purchase and Packing
Queues need. A query that forgets it shows the wrong Store's rows to
someone in the *same* Organization — a bug to catch in review, not a tenant
leak.

**2. The catalog stays Organization-wide.** `products`, `modifiers`,
`modifier_options`, `product_modifier_options`, `product_images` get no
`store_id`. One catalogue, both Stores sell from it — the same reasoning as
ADR-0002 decision 5 (a reseller curates one catalogue), one level down.
Only `orders`, `order_items` and `customers` become Store-scoped.

**3. Access is an explicit grant, per member.** `member_stores` holds
`(member_id, store_id)`. Adding staff (in-app, `/admin/staff`, or
`pnpm member:add`) means picking their Stores. One grant resolves silently;
two or more show a Store switcher in Settings, exactly like the
Organization switcher. There is no implicit "all Stores" — an Admin who
wants both picks both.

**4. `stores` itself IS RLS-scoped.** Unlike `members`/`member_stores`
(which must be read to *establish* scope and so are exempt), nothing reads
`stores` before the Organization scope is set — `getCurrentUser()` resolves
the active Store from `member_stores` alone, by id. So `stores` carries the
ordinary `tenant_isolation` policy, like `products`.

**5. `sessions.active_store_id` is not a better-auth field.** No plugin owns
the concept of a Store. It is a plain column, written only by a direct
Drizzle update (`setActiveStore`), the same pattern as
`users.must_change_password`. `getCurrentUser()` never trusts it at face
value: every request it re-validates the stashed id against the member's
current `member_stores` grants and falls back to their sole grant, so a
stale or forged value can resolve to *no* Store but never to one the member
isn't granted. This also sidesteps the 5-minute session cookie cache — the
active Store is always read fresh from the database.

**6. First-run onboarding moves in-app, for Stores and staff.** An
Organization with no Store cannot log an Order, so this is a hard gate, not
a nudge: while an Organization has zero Stores, its Admin is redirected to
`/onboarding` (create the first Store → optionally add the first teammate →
into the app). `org:create` still bootstraps the Organization, its first
Admin and a "Main" Store from the command line; `/onboarding` is what a
real signup flow would do after that, and building it by hand is how we
learn what that flow needs — the same rationale ADR-0002 decision 10 gave
for keeping provisioning a script. The very first Store an Organization
creates grants its creator access automatically (nobody else exists to
grant it to yet); every Store after that leaves access to an explicit
decision.

**7. The Store does not appear in the URL.** Derived from the session,
re-stamped on switch — ADR-0002 decision 6, unchanged.

## Considered and rejected

- **A second RLS policy for `store_id`.** The correct choice *if* Stores
  were an adversarial boundary. They are not (decision 1). Modelling one
  as a wall would tax every policy and every future migration, and force
  every cross-store admin query — reporting, staffing, transfers — through
  a scope-switching dance.
- **Implicit "all Stores" for Admins** (a nullable `members.store_id`,
  `null` = everything). Rejected in favour of explicit `member_stores`
  rows: an Admin opening a second Store for a new hire may not want to be
  in it themselves, and "the switcher shows what you can actually reach"
  is a cleaner rule than "null means all, except…".
- **A merged cross-Store Purchase Queue.** The same argument ADR-0002 made
  against a merged cross-*Organization* queue for shared Suppliers: worth
  revisiting once we have watched a real Supplier work two Stores, not
  before.

## Deferred, deliberately

- **Editing a member's Store grants after creation.** `member_stores` is
  written at `addStaff` time and by `pnpm member:add`; there is no in-app
  "change which Stores this person can reach" yet, the way
  `changeStaffRole` exists for role. A new Store added later is reachable
  by *new* staff immediately, but existing staff need a grant that no
  screen offers yet.
- **Per-Store settings** (timezone, currency). Same status as the
  per-Organization versions ADR-0002 deferred.
- **`ON DELETE` behaviour for `stores`.** Cascades from `organizations`;
  there is no delete-a-Store path, only suspend.

## Consequences

`withCurrentStore` joins `withCurrentOrganization` as the wrapper
Store-scoped feature code calls; `ServiceContext` gains `storeId` (nullable
— the service still checks it, defence in depth). The `(dashboard)` layout
gains two gates alongside the forced-password-change one: `/onboarding`
(Admin, no Store) and `/select-store` (anyone, no active Store resolved).
`tests/tenant-isolation.test.ts` is unchanged in intent — Store is not a
boundary it needs to assert — but every fixture now creates a Store because
`customers`/`orders`/`order_items` require one.
