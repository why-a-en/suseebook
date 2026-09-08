# SuSeeOS

An internal tool for a Myanmar-based cross-border resale business: Support
Agents log customer requests against a Product catalog; Suppliers buy the
Products from Lazada/TikTok Shop; Support Agents pack and ship the
purchased items to the real Customer once they arrive.

## Language

**Organization**: The tenant — one business account, fully isolated from
any other Organization's data. Called "vendor" earlier in this project's
history; renamed to avoid colliding with the unrelated "Supplier" role
below.
_Avoid_: Vendor, tenant, account, business.

**Store**: A location within an Organization — the counter an Order,
Customer or Order Item belongs to. A *tag, not a tenant boundary*: unlike
Organization, it carries no row-level-security policy, because two Stores
are the same business with the same staff pool and an Admin routinely
works across both. The catalog (Products, Modifiers) stays
Organization-wide; only the transactional records are Store-scoped. A
member is granted specific Stores (see `member_stores`); with two or more,
Settings shows a Store switcher. An Organization with no Store is
non-functional — its Admin is walked through creating the first one at
`/onboarding` on first login.
_Avoid_: Branch, outlet, location (fine in conversation), shop.

**Admin**: The staff role that runs an Organization from the inside —
manages its staff, edits its details, and reads its reports. Access is a
*superset* of the other two roles, so an Admin who also logs Orders needs
one account rather than two. Scoped to their own Organization like any
member: an Admin has no visibility into anyone else's.
_Avoid_: Owner (considered and dropped), superadmin, manager. Not to be
confused with **platform administration** — that's us operating the
service, gated by an environment allowlist, and no in-app role grants it.

**Support Agent**: The staff role that talks to real Customers,
maintains the Product catalog, logs Orders on their behalf, and packs and
ships Order Items once they're Received. Called "Customer Service"
earlier in this project's history; renamed so the stored role value, the
UI label and this glossary finally agree on one name.
_Avoid_: Customer Service, CS, CS agent, "agent" on its own.

**Supplier**: The staff role that buys Products from Lazada/TikTok Shop
against a Customer's Order Item, using the Purchase Queue.
_Avoid_: Buyer, purchaser. Not to be confused with Organization — a
near-synonym in plain English, but a distinct concept here.

**Customer**: A real, searchable person who places Orders — a first-class
entity (name, phone, address), not free text on the Order. Address is
required: it's what lets a Completed item actually get shipped to them.
_Avoid_: Client, account.

**Product**: A catalog entry for something being resold — created once by a
Support Agent, referenced by many Order Items. Carries its own Images
and the subset of each attached Modifier's Options that apply to it.
_Avoid_: Item, listing (that's the Lazada/TikTok Shop side — see Source URL
in DATA_MODEL.md).

**Modifier**: An Organization-wide, reusable attribute type (e.g. "Color",
"Size") with a global list of Options. Attached to whichever Products use
it; new Modifiers/Options can be created inline while creating a Product.
_Avoid_: Variant, attribute, option set.

**Modifier Option**: One value within a Modifier (e.g. "Black" within
"Color"). A Product picks the subset of a Modifier's Options that actually
apply to it — not every Product using "Color" comes in every color.
_Avoid_: Variant, value.

**Order**: A Customer's request, logged by a Support Agent — a header
(who, when) holding one or more Order Items. Has no status of its own;
see Order Item.
_Avoid_: Purchase, transaction, cart.

**Order Item**: One line of an Order — a Product + a Modifier Option
combination + quantity. Carries its own status independently of every
other Item in the same Order — the Supplier's Purchase Queue batches
Items by Product across many different Orders and Customers at once, not
by whole Order, so status can't live at the Order level.
_Avoid_: Line item, order line.

### Order Item Status

Cancelled is reachable from any other stage — the business needs a way to
record "this isn't happening" no matter how far along an Item got, rather
than forcing it through irrelevant stages first.

**Pending**: Logged, not yet purchased.
**Purchased**: Supplier bought it on Lazada/TikTok Shop.
**Received**: Physically arrived with the Support Agent — the signal that
unlocks packing. Purchased alone isn't enough. Deliberately no separate
"Shipped" stage for the in-transit window: it wouldn't unlock any new
capability, so it's not worth the extra manual step.
**Packed**: The Support Agent has boxed it, ready to send.
**Completed**: Sent to the real Customer.
**Cancelled**: Reachable from any stage above except Completed.

### Purchase Queue

The Supplier's dedicated view: Pending Order Items grouped by Product,
across every Order and Customer, so the Supplier can batch-purchase
everyone's request for the same Product in one pass.
_Avoid_: Pending orders, buyer view.

### Packing Queue

Support Agent's dedicated view of Order Items in Purchased / Received /
Packed status — what's arrived and needs packing — kept separate from the
full Order log.
_Avoid_: Purchased orders view (fine in conversation; this is the
canonical name going forward).
