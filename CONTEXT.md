# SuSeeOS

An internal tool for a Myanmar-based cross-border resale business: Support
Agents log customer requests against a Product catalog; Suppliers buy the
Products from Lazada/TikTok Shop; Support Agents pack and ship the
purchased items to the real Customer once they arrive.

## Language

**Store**: The tenant — one shopfront, fully isolated from every other
Store's data by row-level security (ADR-0005). Its catalog, Customers,
Orders and staff all belong to exactly one Store. Provisioned by a Platform
Admin, who invites its first Admin; there is no self-serve signup. Called
"Organization" earlier in this project's history (ADR-0002), and the
database column is still `organization_id` for that reason — the two are the
same thing. A person who works at more than one Store has one login and
switches between them (Settings); reads and writes always follow the active
Store.
_Avoid_: Organization, Vendor, tenant, account, business, branch, outlet,
shop. Location is fine in conversation.

**Invitation**: A pending grant of Store membership, sent to an email
address by an Admin (or, for the first Admin, a Platform Admin). Accepting
it creates the membership — and, if the email is new to the platform, the
account. The inviter never sets the invitee's name or password; those are
the person's own, set when they accept.
_Avoid_: Invite request, join request.

**Admin**: The staff role that runs a Store from the inside — manages its
catalog and staff, edits its details, reads its reports, and invites team
members. Access is a *superset* of the other two roles, so an Admin who also
logs Orders needs one account rather than two. Role is per Store: the same
person can be Admin at one Store and Support Agent at another.
_Avoid_: Owner (considered and dropped), superadmin, manager. Not to be
confused with **Platform Admin** below.

**Platform Admin**: Us, operating the service. Creates Stores, invites their
first Admins, and can read across every Store from the `/platform` console.
Gated by an environment allowlist — no in-app role grants it, and no tenant
Admin has any of it.
_Avoid_: Superadmin, root, staff.

**Support Agent**: The staff role that talks to real Customers,
maintains the Product catalog, logs Orders on their behalf, and packs and
ships Order Items once they're Received. Called "Customer Service"
earlier in this project's history; renamed so the stored role value, the
UI label and this glossary finally agree on one name.
_Avoid_: Customer Service, CS, CS agent, "agent" on its own.

**Supplier**: The staff role that buys Products from Lazada/TikTok Shop
against a Customer's Order Item, using the Purchase Queue. One person can be
a Supplier for several Stores (one login, one membership per Store).
_Avoid_: Buyer, purchaser.

**Customer**: A real, searchable person who places Orders — a first-class
entity (name, phone, address), not free text on the Order. Address is
required: it's what lets a Completed item actually get shipped to them.
_Avoid_: Client, account.

**Product**: A catalog entry for something being resold — created once by a
Support Agent, referenced by many Order Items. Carries its own Images
and the subset of each attached Modifier's Options that apply to it.
_Avoid_: Item, listing (that's the Lazada/TikTok Shop side — see Source URL
in DATA_MODEL.md).

**Modifier**: A Store-wide, reusable attribute type (e.g. "Color",
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
