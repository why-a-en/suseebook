# PRD: SuSeeOS — Order & Product Coordination Platform

**Status:** Draft v2
**Owner:** Yan Min Thwin
**Last updated:** 2026-08-23

---

## 1. Background

The business model today:

1. A product sale post goes out on social media (Facebook/Instagram/etc.).
2. Interested customers message in and send reference images, then clarify
   modifiers (color, size, variant, etc.) and quantity in chat.
3. A **Supplier** has to go find and purchase that exact item on Lazada or
   TikTok Shop — usually by searching with the image the customer sent.
4. There's a shared chat group between the Supplier and the
   **Support Agents**. A Support Agent posts each customer's order into that group
   as a message: a screenshot + product info + modifiers + quantity.
5. The Supplier scrolls the group, manually reads every message, and tracks
   in their head (or notes) what still needs to be bought.
6. Once bought and shipped to the Support Agent, the item still has to be
   **packed and sent to the real customer** — a step the current chat-based
   process doesn't track at all; it just happens informally once the parcel
   shows up.

### Problems with the current process

- **No structure.** Orders live as chat messages. Nothing is a record —
  it's a scrollback the Supplier has to re-read.
- **No source-of-truth for products.** The same product may be described
  slightly differently depending on which Support Agent is handling it,
  or re-typed from scratch each time a customer asks about it.
- **Wasted Supplier effort.** The Supplier re-does image search on Lazada/TikTok
  even when a Support Agent already found and clarified the exact listing
  during the chat with the customer — that link is thrown away once it's
  screenshotted into the group.
- **No aggregation.** If three customers order the same product today,
  the Supplier discovers this by luck while scrolling, not by design — so
  they may buy it three separate times instead of once, or miss orders
  entirely.
- **No status visibility.** Nothing tells anyone (Support Agent, Supplier, or the
  business owner) what's been bought, arrived, packed, or sent.
- **Not searchable.** Finding "what did customer X order yesterday" means
  scrolling chat history.

## 2. Goal

Replace the shared-chat-as-database workflow with a lightweight internal
tool where:

- **Support Agents** build and maintain a **product catalog**, logs
  each **customer's order** against it, and — once an item is bought and
  arrives — **packs and ships it** to the real customer.
- The **Supplier** gets a clean, always-current, *grouped-by-product*
  purchase queue: everyone who wants the same item today, in one glance,
  bought in one pass — not a list of individual orders to scan one by one.

## 3. Scope decisions (locked for MVP)

| Decision | MVP choice |
|---|---|
| Payment tracking | **Out of scope.** No deposit/paid/unpaid tracking; payment stays a manual, off-platform concern. |
| Supplier concurrency | **Single Supplier.** No claiming/assignment mechanism. |
| Order Item lifecycle | **`Pending → Purchased → Received → Packed → Completed`**, with `Cancelled` reachable from any stage except Completed. See [ADR-0001](./adr/0001-order-item-lifecycle-and-packing.md) for why this isn't the "minimal" lifecycle the first draft of this PRD assumed. |
| Order structure | An **Order** can hold **multiple Products**, each its own **Order Item** (Product + modifier selection + quantity), each with its **own** status — not one status per Order. Every Order Item must reference a catalog Product; no ad-hoc/one-off items without a Product record. |
| Modifiers | **Structured, not free text.** A Modifier (e.g. "Color") is a reusable, Organization-wide catalog with a global list of Options; each Product picks the subset of a Modifier's Options that apply to it. |
| Customer | **A real, searchable entity** (name + phone + address) — not free text re-typed on every order. |
| Roles & permissions | **Three roles** (Admin, Support Agent, Supplier), each with its own default views — **not** a granular permission system. The split is mostly about what you land on rather than what you're blocked from; the exception is Admin, whose staff-management screens are genuinely gated. |
| Account creation | **First account out of band, staff management in-app.** A new Organization's first login is created by script (`pnpm store:create`); after that an Admin adds and manages staff from within the app. No emailed invitations — the Admin sets a password and passes it on directly, keeping an email provider out of the stack. |
| Customer-facing access | **None.** Customers stay in chat/social media; they are not platform users in the MVP (see idea in §9). |

## 4. Users & Roles

Three roles, each landing on a different default view. For Support Agent and
Supplier the split is about UX rather than access control; Admin is the one
role that unlocks something the others genuinely cannot reach.

| Role | Who | Lands on | Can do |
|---|---|---|---|
| **Admin** | The reseller's own administrator — usually the owner, who also works day to day | The Order log | Everything both other roles can do, plus manage their Organization's staff and edit its details. A **superset**, so one person doesn't need two accounts |
| **Support Agent** | Staff handling customer chats, product upkeep, and packing | The Order log | Create/edit products (incl. Modifiers); create Orders/Customers; view & filter all Orders; work the **Packing Queue** (Received → Packed → Completed) |
| **Supplier** | Staff who purchases from Lazada/TikTok Shop | The **Purchase Queue** | View/search products; batch-mark Order Items Purchased, grouped by Product across every Order and Customer; view Order history |

Support Agent and Supplier can technically reach any operational
screen/action — there's no backend permission matrix — but each role's
navigation shows/hides what's relevant to their job (e.g. Supplier doesn't
see a "Create Product" button in their nav).

Admin is different: its staff-management screens check the role on the
server, not just in navigation. Hiding a shortcut is not access control.

The **first** account for a new Organization is still created out of band,
by running `pnpm store:create`. Admin exists so that everything *after* that
— adding staff, changing roles, suspending someone who has left — no longer
needs a script run by us. Emailed invitations remain deferred: an Admin
creates the account and passes a generated one-time password on directly,
which keeps an email provider out of the stack. The account's owner must
replace that password before doing anything else, and a forgotten one is
reset by an Admin rather than by self-service — see
[ADR-0002](./adr/0002-multi-tenancy-mvp.md) and
[ADR-0003](./adr/0003-password-recovery-and-forced-change.md).

## 5. Core Concepts / Data Model

Full technical schema lives in [DATA_MODEL.md](./DATA_MODEL.md); this is
the product-level shape. Every concept below belongs to exactly one
**Organization** (the business/tenant) — irrelevant at this team's size,
but see [TECH_STACK.md](./TECH_STACK.md) for why it's modeled from day
one.

### 5.1 Product

The catalog entry for something being resold — created once, referenced
by many Order Items.

| Field | Notes |
|---|---|
| Name | Required |
| Description | Required |
| Images | One or more |
| Source URL | **Link to the exact listing**, if known — see §9.1, the single highest-leverage field on this record. No separate marketplace field; the URL alone is enough. |
| Modifiers | Which of the Organization's Modifiers apply to this Product, and which of each Modifier's Options — e.g. this product uses "Color" and offers Black/White (out of a larger global Color palette) |
| Price (customer-facing, MMK) | Optional for MVP |
| Status | Active / Archived — Archived products drop out of the order-creation picker but existing Order Items referencing them are untouched; reversible |
| Created by / Created at | Audit trail |

### 5.2 Modifier & Modifier Option

A **Modifier** (e.g. "Color", "Size") is a reusable attribute type,
shared across the whole catalog — not typed fresh per product. Each
Modifier has a global list of **Options** (e.g. "Black", "White", "Red"
under "Color"). Both can be created inline while creating or editing a
Product, so a Support Agent never has to leave the flow to set one up.

A Product doesn't automatically get every Option of a Modifier it uses —
it picks the subset that actually applies to it (this T-shirt only comes
in Black/White, even though "Color" globally has more options).

### 5.3 Customer

A real, searchable entity — not free text re-typed on every order.

| Field | Notes |
|---|---|
| Name | Required |
| Phone number | Required |
| Address | Required — needed to actually ship a Purchased item to them |
| Created at | |

Created inline while logging an Order (search-or-create), the same
pattern as Modifiers on Products.

### 5.4 Order

A single request from a Customer, logged by a Support Agent. **Has no
status of its own** — see §5.5 and [ADR-0001](./adr/0001-order-item-lifecycle-and-packing.md)
for why. Can hold one or more Products.

| Field | Notes |
|---|---|
| Customer | Required, references a Customer |
| Screenshot | Optional image upload — the chat screenshot, useful during transition / for disputes |
| Notes | Free text |
| Created by (Support Agent) / Created at | Audit trail |

### 5.5 Order Item

One line of an Order: one Product, one Modifier-Option combination, one
quantity. Carries its **own** status, independently of every other Item
on the same Order — this is what lets the Supplier's Purchase Queue
batch-purchase one Product across many different Orders and Customers at
once without disturbing unrelated Items.

| Field | Notes |
|---|---|
| Order | Required, references an Order |
| Product | Required, references a Product |
| Selected modifier(s) | e.g. Color=Black, Size=M — chosen from that Product's available Options |
| Quantity | Required, default 1 |
| Status | `Pending` → `Purchased` → `Received` → `Packed` → `Completed`, or `Cancelled` from any stage except Completed |
| Cancellation reason | Optional free text, captured when status → Cancelled |
| Purchased at / Received at / Packed at / Completed at | Set automatically on each transition |

### 5.6 User

| Field | Notes |
|---|---|
| Name | |
| Email / username | |
| Role | Support Agent / Supplier (see §4) |

## 6. Features (MVP)

### 6.1 Product Management (Support Agent)
- Create a product: name, description, images, source URL, price — and,
  right on the same form, an optional first Modifier (name + options).
  Uploaded images go straight to storage from the browser, not through
  the server.
- Attach more Modifiers to it — pick from existing ones, or create a new
  Modifier (and its Options) inline — from the product's own page after
  creation.
- Edit / archive a product.
- List/search products (by name, status).

### 6.2 Order Management (Support Agent)
- Create an order: search-or-create the Customer, then add one or more
  Order Items (product, modifier selection, quantity each), plus an
  optional screenshot/note for the whole order.
- Edit an Order Item (e.g. fix quantity) while still Pending.
- Cancel an Order Item, from any stage before Completed, with an
  optional reason.
- View/filter the Order log — by status, date, customer.

### 6.3 Purchase Queue (Supplier)
The Supplier's dedicated, filterable home screen — **the core feature**:
Pending Order Items grouped by Product, across every Order and Customer,
so today's demand for each product is visible **at a glance**, not by
scanning a list of individual orders.

- Each group shows: product image, name, source URL (tap to jump
  straight to the Lazada/TikTok listing), total quantity needed, and how
  many distinct orders make up that total.
- **Batch action**: mark an entire group Purchased in one tap — every
  matching pending Order Item, across every order/customer, moves to
  Purchased together.
- Filterable (by product/search).
- Separate view to search/filter Order history (all statuses, past
  dates).

### 6.4 Packing Queue (Support Agent)
A dedicated, filterable view of Order Items in Purchased / Received /
Packed status — separate from the general Order log, because "what's
arrived and needs packing" is a different question from "what did we log
today."

- Mark an item Received (arrived), then Packed, then Completed (sent to
  the customer).
- Filterable by sub-status, date, customer.

### 6.5 Auth
- Simple login (email/password) so actions are attributed to a person.
- Each role sees timestamps in its own local time: Supplier in Thailand
  time, Support Agent in Myanmar time (presentation-only — no data
  actually changes).

## 7. User Flows

### 7.1 A Support Agent logs a new order
1. Customer in chat sends images and says "I want this in black, size M,
   qty 2, and also this other thing in red."
2. The Support Agent searches for the Customer (or creates them, if new).
3. For each item the customer wants: search the catalog for the matching
   product (creating it first, with modifiers, if it doesn't exist yet),
   pick the modifier selection and quantity, add it as an Order Item.
4. Attach the chat screenshot/notes to the Order as a whole. Save.
5. Every new Order Item appears instantly in the Supplier's Purchase
   Queue, grouped with anyone else's request for the same product. No
   chat message needed.

### 7.2 Supplier clears today's Purchase Queue
1. Supplier opens the Purchase Queue — sees every product with pending
   demand, grouped, with total quantity needed per product.
2. Taps a product's source URL to jump straight to the Lazada/TikTok
   listing (skips manual image search entirely, when the URL was
   captured).
3. Buys the total quantity needed for that product in one purchase.
4. Taps the batch action — every pending Order Item in that group moves
   to Purchased at once.
5. Repeats for the next product group. Done for the day once the queue's
   clear.

### 7.3 A Support Agent packs and ships
1. The Support Agent opens the Packing Queue once a Purchased item
   physically arrives, marks it Received.
2. Packs it, marks it Packed.
3. Sends it to the real customer, marks it Completed.

## 8. Non-Functional Requirements

- **Mobile-first, not just mobile-friendly.** Hard requirement — Support
  Agents and the Supplier use this primarily on phones. Every screen is
  designed for the smallest target size first (~320–375px), then
  progressively enhanced upward.
- **Performant and robust on real-world phone browsers.** Reliable on
  mid-range Android devices, on Chrome Android / Safari iOS / Samsung
  Internet, tolerant of variable/slow mobile networks (see
  [TECH_STACK.md](./TECH_STACK.md)).
- **Fast product/order entry**: at least as fast as typing a chat
  message — minimize required fields, support pasting an image directly.
- **Image storage**: reliable image upload/storage (product images +
  order screenshots).
- **Small scale**: single small team, low concurrent users — no need to
  over-engineer for scale in MVP.

## 9. Future Ideas / Post-MVP

1. **Marketplace URL capture as a first-class habit.** The single
   biggest efficiency win available: once a Support Agent (or the
   customer) finds the item on Lazada/TikTok, paste the URL into the
   product record so the Supplier's search-by-image step disappears
   almost entirely.
2. **Smarter order aggregation for the Supplier.** Running totals across
   a rolling window ("12 pending items for Product X across the last 3
   days"), beyond same-day grouping.
3. **Payment tracking.** Deposit/paid/unpaid status per Order Item, so
   the Supplier only purchases funded orders. Deferred per §3; likely
   the first thing to revisit post-MVP.
4. **Multi-Supplier support with claiming.** If a second Supplier joins,
   an explicit "claim" action prevents two people buying the same item.
5. **Customer-facing lookup.** A simple, no-login page/link a Support
   Agent can send a customer to see their own order status — more
   feasible now that Customer is a real entity, but still deferred.
6. **Ad-hoc Order Items without a pre-made Product.** For rare one-off
   items not worth cataloging.
7. **Basic reporting.** Daily/weekly counts, most-ordered products,
   cancellation reasons breakdown (now cheap, since reasons are
   captured) — useful once volume grows.
8. **Notifications.** Ping the Supplier when new items land in the
   Purchase Queue, instead of them having to check the app.
9. **Direct chat/social integration.** Auto-create a draft order from a
   forwarded chat message or DM.
10. **In-app account management.** Once the team's bigger than a
    script-based setup comfortably supports.
11. **A distinct "Shipped" (in-transit) Order Item status.** Deliberately
    skipped in [ADR-0001](./adr/0001-order-item-lifecycle-and-packing.md) —
    revisit only if people actually start asking "is it shipped yet."

## 10. Success Metrics

- Supplier clears the day's purchasing by scanning one grouped screen,
  not scrolling a chat group or a flat order list.
- Time from "a Support Agent logs an item" to "it's visible in the
  Purchase Queue" is near-instant.
- A Support Agent can tell, at a glance, what's arrived and needs
  packing vs. what's still out for purchase.
- Reduction in duplicate purchases or missed orders caused by chat
  scrollback being the only record.

## 11. Open Questions

None outstanding — this section will pick up again as new questions
surface during build.
