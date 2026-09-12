# Tech Stack & Infrastructure

**Status:** Draft v1
**Last updated:** 2026-08-23
**Related:** [PRD.md](./PRD.md)

---

## 1. Summary

| Layer | Choice |
|---|---|
| Framework | **Next.js** (App Router, TypeScript), hosted on **Vercel**, function region pinned to `sin1` (Singapore) |
| Database | **Neon Postgres**, provisioned in a Singapore (AP Southeast) region |
| ORM | **Drizzle** |
| Auth | **Self-rolled** (email/password, session cookies) — deliberately temporary, see §2 |
| File storage | **Cloudflare R2** (S3-compatible) |
| CDN / DNS | **Cloudflare**, sitting in front of the app (free tier) |
| Live updates | Polling / SWR revalidation for MVP; revisit only if genuinely needed |
| UI | **Tailwind CSS + shadcn/ui** |

## 2. Why this stack

### Next.js + Vercel
One codebase for frontend + backend (Server Actions), fast iteration via
git-based deploys, free tier comfortably covers a small internal tool's
traffic. Hosting is not a lock-in risk — it's a standard Next.js app,
portable to another host later with minimal change.

### Neon Postgres (not Supabase)
Relational data fits this domain (organizations ↔ products ↔ orders ↔
users). We initially considered Supabase for its bundled
DB+Auth+Storage+Realtime, but rejected it: those bundled services wrap
Postgres in Supabase-specific mechanics (GoTrue JWTs, PostgREST
auto-API, RLS conventions tied to its auth), which becomes a real
migration cost once this grows into a **multi-tenant platform** with
its own auth/billing/onboarding needs. Plain Postgres (Neon) has no
such wrapper — same SQL runs anywhere, and Neon lets us pick a region
close to our actual users.

### Self-rolled auth (not Clerk / Supabase Auth) — deliberately temporary
We considered Clerk (its Organizations feature maps well onto
multi-tenant B2B — one Clerk org per tenant), but decided to roll our
own for now instead, with the explicit intent to migrate to a managed
provider (Clerk or otherwise) once the platform is genuinely
multi-tenant and auth needs grow (SSO, invites, MFA, etc.).

Kept deliberately minimal and boring, so it's cheap to rip out later:
- **Password hashing:** argon2.
- **Sessions, not JWTs:** a `sessions` table (`token_hash`, `user_id`,
  `expires_at`) checked on each request via an httpOnly, secure,
  `sameSite=lax` cookie. This is the standard pattern for this kind of
  build (the one popularized by Lucia's guides) — it allows real
  revocation/"log out everywhere," unlike stateless JWTs.
- **Isolated behind one module.** All auth logic (hashing, session
  creation/validation, login/logout) lives in a single module the rest
  of the app calls through — never scattered across routes — so
  swapping in a managed provider later is a contained change, not a
  rewrite.
- `users.email` / `users.password_hash` are plain, portable columns —
  no organization-specific user ID to migrate away from.

### Cloudflare R2 for storage, Cloudflare as CDN/DNS
S3-compatible API — an industry standard, trivially portable to AWS S3
later, never coupled to the app framework. Cloudflare also has strong
edge presence in Southeast Asia, which matters most for the
bandwidth-heavy parts of this app (product images, order screenshots) —
so we get Cloudflare's regional strength where it actually helps,
without taking on the compatibility friction of running Next.js itself
on Cloudflare Workers (Node API gaps, edge-only ORM drivers, D1's
relational limitations vs Postgres).

### Region choice — Myanmar & Thailand users
The actual latency lever is **region pinning**, not platform choice:
- Vercel serverless functions default to a US region unless pinned —
  pin to **Singapore (`sin1`)**, the closest available region to both
  Myanmar and Thailand.
- Provision Neon's Postgres instance in a **Singapore region** too, so
  app server and DB are co-located instead of each hopping
  cross-region independently.
- Static assets are already served from Vercel's global edge CDN
  regardless of function region, so this only affects API/DB
  round-trips — which is exactly where it matters.

*Known caveat, unrelated to any host choice:* Myanmar's internet has had
real connectivity/reliability issues (throttling, intermittent
restrictions) independent of infrastructure provider — worth being
aware of, not something any CDN fully solves.

## 3. Explicitly rejected / deferred

| Option | Why not (for now) |
|---|---|
| **Supabase** (bundled DB+Auth+Storage+Realtime) | Great for a single-tenant MVP, but its bundled services couple app logic to Supabase-specific mechanics — expensive to unwind once this becomes a real multi-tenant platform. |
| **Full Cloudflare stack** (Workers + D1/Hyperdrive) | Cloudflare Workers' Next.js support (`@opennextjs/cloudflare`) has real rough edges (Node API gaps, edge-only ORM drivers); D1 is less mature than Postgres for relational multi-tenant data. Not worth the complexity at current traffic levels. |
| **Real-time push (Pusher/WebSockets/Supabase Realtime)** | Supplier's "instant" Purchase Queue can be served by simple polling/SWR revalidation at this scale (a few staff, low order volume) — a 3–5s poll is indistinguishable from push here. Revisit only if usage grows enough to need it. |
| **Clerk / managed auth** | Not rejected, just deferred — self-rolled auth (§2) covers MVP needs with zero added services. Revisit once multi-tenant onboarding needs SSO, invites, or MFA; the plain `email`/`password_hash` schema is designed to make that swap cheap. |

## 4. Multi-tenancy — the decision that matters more than tool choice

Even though the MVP has exactly one Organization (you), the schema is
built multi-tenant from day one, because retrofitting this later is far
more painful than designing for it now:

- **Shared schema, `organization_id` column on every tenant-scoped
  table** (the standard, scalable SaaS pattern — Slack/Notion-style
  workspace model), rather than schema-per-tenant or
  database-per-tenant (which becomes operationally painful once there
  are more than a handful of Organizations — migrations run N times).
- **Postgres Row-Level Security (RLS) policies keyed on
  `organization_id`** as defense-in-depth on top of app-level scoping —
  a native Postgres feature (works on Neon, not Supabase-exclusive).
  This protects against the classic bug of a query missing its `WHERE
  organization_id = ...` clause and leaking one Organization's data to
  another — cheap insurance now, a real incident later if skipped.

(Called "vendor" earlier in this project — renamed to "Organization" to
stop colliding with the unrelated "Supplier" role; see
[CONTEXT.md](./CONTEXT.md). A sub-Store layer briefly existed underneath
this boundary — ADR-0004 — and was collapsed back out of it by ADR-0005:
`organization_id` is Store now, one boundary, no naming split left to
explain here.)

See [DATA_MODEL.md](./DATA_MODEL.md) for the schema this produces.

### Neon role setup: `app_user` vs. the owner role

The app **does not connect as `neondb_owner`**. Two Postgres roles exist
on the Neon project:

| Role | Used for | Created via |
|---|---|---|
| `neondb_owner` | Schema migrations only (`DATABASE_URL_UNPOOLED`) | Neon (default project owner) |
| `app_user` | All app runtime queries (`DATABASE_URL`, pooled) | **Plain SQL**, by hand |

This split exists because of a real gotcha, caught by actually testing
cross-org isolation rather than assuming the RLS SQL worked: **any
role created through Neon's console, CLI, or API is granted
`neon_superuser` membership, which includes `BYPASSRLS`** — it skips
every RLS policy unconditionally, regardless of `FORCE ROW LEVEL
SECURITY`. `neondb_owner` has it too (it's the default project role).

`app_user` was created with plain SQL instead, which Neon does *not*
upgrade to `neon_superuser`:

```sql
create role app_user with login password '...';
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
```

If this project's database is ever recreated, or a new environment is
provisioned, **recreate `app_user` the same way — never via `neon roles
create` or the Neon console** — and re-verify with a real cross-org
test (insert two organizations' data, confirm a session scoped to one
can't see the other's), not just by checking the policy SQL ran without
error.

## 5. Cost expectation

Vercel free tier + Neon free tier + Cloudflare free tier (R2 + CDN/DNS)
should run this at **$0/month** through MVP and likely well into early
multi-tenant growth. Self-rolled auth adds no service cost at all — the
first dollar spent on auth will be whenever we deliberately migrate to
a managed provider.

## 6. Mobile-first, and robust on real-world phone browsers

Hard requirement, not a nice-to-have — see
[PRD.md §8](./PRD.md#8-non-functional-requirements). Support Agents and the
Supplier use this primarily on phones, realistically mid-range Android
devices on Myanmar/Thailand mobile networks — not flagship phones on
fast wifi. That shapes concrete build decisions, not just a CSS
media-query afterthought:

- **Design mobile-first, literally.** Build each screen for the
  smallest target width (~320–375px) first with Tailwind's default
  (unprefixed) styles, then layer on `sm:`/`md:`/`lg:` overrides for
  larger viewports — never the reverse. A layout that was designed for
  desktop and then "made responsive" is exactly what this rules out.
- **Keep client-side JS small.** Lean on React Server Components for
  anything that doesn't need interactivity; keep client components
  (forms, the mark-purchased action, image pickers) as small, isolated
  islands. Smaller JS payload matters more on slow/variable mobile
  networks than on desktop broadband.
- **Images are the heaviest part of this app** (product photos, order
  screenshots) — use `next/image` for automatic resizing/lazy-loading,
  compress/resize on upload before it lands in R2, and serve thumbnails
  in list views rather than full-resolution originals.
- **Network resilience over hard failure.** Assume requests can be slow
  or drop mid-flight: show optimistic/loading states rather than blank
  screens, and make image uploads retry-friendly instead of failing the
  whole form on one flaky request.
- **Respect device chrome.** Any fixed-position UI (e.g. a bottom action
  bar) uses `env(safe-area-inset-*)` padding so it doesn't collide with
  iOS/Android gesture bars or the browser's own bottom nav.
- **Target browser matrix:** Chrome for Android, Safari iOS, and Samsung
  Internet — the realistic spread for this user base. Avoid
  bleeding-edge CSS/JS features without checking support across all
  three rather than just testing in one desktop browser's dev tools.
- **Test on real, mid-range devices** before calling something done —
  an emulator or a high-end iPhone hides exactly the performance
  problems this requirement exists to catch.
