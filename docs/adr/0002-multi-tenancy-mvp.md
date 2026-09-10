---
status: accepted
---

# Multi-tenancy MVP: identity split from membership, one active Organization per session

> **Amended by [ADR-0005](./0005-store-as-sole-tenant.md).** The tenant is now
> called a **Store** (the Organization layer was removed); the DB column stays
> `organization_id`. The identity/membership split, suspension model and
> impersonation here all still hold — read "Organization" as "Store", and
> "one active Organization per session" as "one active Store". §6's onboarding
> and §10's `org:create` are replaced by Platform-Admin provisioning +
> invitations.

The schema has been multi-tenant since the first migration — `organization_id`
on every tenant-scoped table, RLS keyed on `app.organization_id`, a
non-`BYPASSRLS` `app_user` role
([TECH_STACK.md §4](../TECH_STACK.md#4-multi-tenancy--the-decision-that-matters-more-than-tool-choice),
[DATA_MODEL.md §5](../DATA_MODEL.md#5-row-level-security--enforced-two-ways-and-neither-is-optional)).
What was never built is the *lifecycle* around it: how an Organization comes
into existence, who belongs to one, and what happens when a person belongs
to two.

Two Organizations are now live — one ours, one an external client's — and
the platform will be pitched to further resellers. That makes the following
decisions due now rather than later.

## The problem that forces this

`users` carries both `organization_id` and `role`, and `users.email` is
globally unique. That combination means **one person can belong to exactly
one Organization, forever.**

Suppliers are shared. A Thailand-side sourcer buying from Lazada and TikTok
Shop may work for several Myanmar resellers at once. Under the current
schema that person needs a separate email address per Organization, which is
not a workaround so much as a defect we would be asking a user to absorb.

## Decisions

**1. Identity is split from membership.** `users` holds the person (email,
credentials). A `member` table holds `(user_id, organization_id, role)`,
unique on the pair. `users.email` stays globally unique — that is now
*correct*, because an email identifies a person rather than a person within
an Organization.

**2. Role moves onto the membership.** A person can be a Support Agent at
one Organization and Supplier at another. Role is a property of belonging,
not of the person.

**3. The session carries the active Organization.** Not the user. Every
feature already reads `ctx.organizationId` from
`withCurrentOrganization()`, so this is where the change lands and stops —
`src/lib/tenancy.ts` keeps its signature and no feature code moves.

Role is resolved by joining the membership rather than denormalised onto the
session, so a role change takes effect immediately instead of going stale.

**4. One Organization at a time, with a switcher.** A shared Supplier sees
one Organization's Purchase Queue and switches between them. RLS therefore
stays absolute: no cross-tenant reads, no escape hatch, no exception to
remember.

**5. Products stay private to an Organization.** Considered making them
shared, since a Product wraps a Lazada or TikTok Shop listing that several
resellers could equally sell. Rejected — each reseller curates their own
catalogue, so "everything is org-scoped" remains true without exception.

**6. The Organization does not appear in the URL.** It is derived from the
session. Switching re-stamps the session. This is a phone-first app where a
user is in one Organization at a time; a path or subdomain segment would
touch every route and link for no benefit today. An `organizations.slug`
column is kept so subdomains remain possible.

**7. Auth moves to [better-auth](https://better-auth.com).** Self-hosted and
MIT-licensed, so it introduces no vendor and no sanctions exposure — see
[myanmar-compliance.md](../research/myanmar-compliance.md). Its organization
plugin implements decisions 1–4 directly: a `member` table, multi-org
membership, `session.activeOrganizationId`, and `organization.setActive()`.
Existing argon2 hashes are preserved through custom `password.hash`/`verify`,
so live users never see a forced reset. Full evaluation, including one
accepted security trade-off, in
[better-auth-spike.md](../research/better-auth-spike.md).

**8. Organization suspension is enforced.** `organizations.status` has
existed since the first migration and nothing has ever checked it. It is the
only lever over a client account, and with an external tenant live it needs
to work.

**9. Cross-org isolation is tested automatically.** DATA_MODEL.md §5 records
that isolation was verified with real fixtures — once, by hand. With another
company's data in the database, and with more of the tenant boundary about
to run through library code, that check belongs in CI. The test must assert
that a scope on Organization A cannot read B's rows *even through a query
that omits its `organization_id` filter*, and that a shared Supplier stamped
to A sees only A.

**10. Provisioning stays a script.** `create-organization` and
`add-membership`, run by hand. Manual onboarding is correct at this size and
is what will eventually tell us what a signup flow should actually do.

## Considered and rejected

- **Keeping one Organization per user, and asking shared Suppliers to hold
  two accounts.** Rejected: it pushes a modelling failure onto the user, and
  the migration only gets more expensive as tenants accumulate.
- **A merged, cross-Organization Purchase Queue** for shared Suppliers.
  Arguably closer to the real workflow — a Supplier buys from Lazada in one
  pass regardless of whose customer an item is for. Rejected for now because
  it requires deliberate cross-tenant reads and would break the invariant
  that makes RLS trustworthy. Worth revisiting once we have watched a shared
  Supplier actually work across two clients.
- **A managed auth provider** (Clerk, WorkOS, Auth0). No legal barrier was
  found, but each adds a counterparty and moves identity data out of our
  Postgres for no capability we need.
- **An `owner` role and in-app user management.** Deferred. Because role now
  lives on the membership, adding it later is a single new value.
- **Per-Organization timezone, currency and language.** Both live
  Organizations share settings, so `timezoneForRole()` stays hardcoded and
  is marked as tenant #1's assumption.

## Deferred, deliberately

Billing and plans, usage limits, self-serve signup, custom domains,
per-tenant audit logs, SSO, invitations and password reset. None constrains
the schema, so postponing them costs nothing.

> **Update ([ADR-0005](./0005-store-as-sole-tenant.md),
> [ADR-0006](./0006-transactional-email.md)):** invitations and credential
> delivery are no longer deferred. Joining a Store is by invitation link
> (the person sets their own password); a password *reset* is emailed as a
> temporary password via Resend (`suseeos.com`), deliverability-checked
> first. Still deferred: tenant-facing self-serve signup, and any
> non-credential email.

> **Update (`feat/platform-console`):** the first slice of the deferred
> "platform-admin console" now exists as a **separate surface** — `/platform`,
> its own layout and routes, no tenant chrome. A platform operator has **no
> tenant footprint** (no `members` row, no Organization); `resolveSession()`
> in `src/lib/auth` returns a `SessionUser` XOR a `PlatformUser`, and the two
> route trees redirect each other's users away. The operator provisions
> client Organizations + their first Admin (the in-app `pnpm org:create`),
> suspends them via `organizations.status`, and steps into one by
> impersonating. `PLATFORM_ADMIN_USER_IDS` stays the single source of truth.
> Still deferred: billing, usage, and any *tenant-facing* onboarding.

Two known gaps are recorded rather than fixed:

- **R2 objects are readable by anyone holding the URL.** Keys are namespaced
  per Organization and use random UUIDs, so images are unlisted rather than
  public. Acceptable for marketplace product photos; not a model to carry
  into anything more sensitive.
- **No `onDelete` on the FKs to `organizations`.** Off-boarding a tenant
  currently requires hand-written SQL.

## Consequences

`users.organization_id` and `users.role` are dropped; `member` replaces
them. `member` sits *outside* RLS alongside `users` and `sessions` — it is
read in order to establish the scope, so it cannot be gated on the scope.

`src/lib/tenancy.ts` keeps its interface, so the ten call sites reading
`user.role` and every feature reading `ctx.organizationId` are untouched.
