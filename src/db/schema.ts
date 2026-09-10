// Schema mirrors docs/DATA_MODEL.md — keep both in sync when this changes.
import {
  pgTable,
  pgEnum,
  pgPolicy,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Enums ---------------------------------------------------------------

export const organizationStatusEnum = pgEnum("organization_status", ["active", "suspended"]);
// Mirrors organizationStatusEnum — the same "suspend without deleting"
// lever, one level down, for a store that's temporarily closed.
export const storeStatusEnum = pgEnum("store_status", ["active", "suspended"]);
// Per-membership, deliberately not per-user. better-auth's admin plugin
// offers users.banned, but that is global — suspending a Supplier who
// sources for two resellers would lock them out of both. Access is granted
// by the membership, so it is revoked there too.
export const memberStatusEnum = pgEnum("member_status", ["active", "suspended"]);
export const productStatusEnum = pgEnum("product_status", ["active", "archived"]);
// See docs/adr/0001-order-item-lifecycle-and-packing.md for why this has
// five stages, not three, and why cancelled is reachable from all of them.
export const orderItemStatusEnum = pgEnum("order_item_status", [
  "pending",
  "purchased",
  "received",
  "packed",
  "completed",
  "cancelled",
]);

// A cancelled Order Item is a soft delete — the row stays (Order.notes,
// Customer history, and every other stage's own timestamp below all still
// reference it), it just drops out of every active view (Purchase Queue,
// Parcels, the Order's own pending count). This sentinel is what lets the
// dedicated /unsourced page find only the ones a Supplier gave up sourcing,
// not every cancellation (Support can also cancel from the Order detail
// page, for any other reason, via the same status). It's a fixed string set
// by app code, not user-entered text, so exact-matching it is reliable —
// still, always import this constant rather than retyping the literal.
export const CANT_SOURCE_REASON = "Supplier couldn't source it";

// RLS defense-in-depth (docs/DATA_MODEL.md §5): every tenant-scoped table
// gets this same policy. withCheck is intentionally omitted — Postgres
// falls back to using USING for INSERT/UPDATE checks too when WITH CHECK
// isn't given, so this one expression covers reads and writes.
//
// Every table using this also needs `ALTER TABLE ... FORCE ROW LEVEL
// SECURITY` added by hand to its migration — Drizzle's .enableRLS() only
// emits plain ENABLE, and Postgres exempts a table's *owner* from RLS
// unless FORCE is set too. Our app connects as the owning role, so
// without FORCE these policies would silently do nothing.
const tenantIsolationPolicy = () =>
  pgPolicy("tenant_isolation", {
    using: sql`organization_id = current_setting('app.organization_id')::uuid`,
  });

// --- Tables ----------------------------------------------------------------

// --- Auth tables -----------------------------------------------------------
//
// Owned by better-auth (docs/plans/better-auth-migration.md). Shapes are
// dictated by @better-auth/core's table definitions, but expressed in this
// file's conventions — `uuid` primary keys rather than better-auth's default
// text ids (config.ts sets `advanced.database.generateId: "uuid"` to match),
// and `withTimezone` timestamps.
//
// NONE of these are RLS-scoped, and that is not an oversight: each is read in
// order to *establish* the tenant scope, so none can be gated on it. See
// docs/DATA_MODEL.md §5 and ADR-0002.

// The tenant. One row per business using the platform.
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Required by better-auth's organization plugin. Nothing routes by slug
  // today — ADR-0002 keeps the Organization out of the URL — but it is kept
  // populated so subdomains stay possible without a backfill later.
  slug: text("slug").notNull(),
  logo: text("logo"),
  metadata: text("metadata"),
  // Pre-dates better-auth; carried through as an `additionalFields` entry in
  // config.ts. Suspension is the only lever over a client account.
  status: organizationStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)]);

// One physical/operational location within an Organization. A tag, not a
// tenant boundary: unlike organization_id, store_id carries no RLS policy —
// two stores are the same business, same staff pool, and an Admin routinely
// needs to see both without a scope-switching dance. It exists so Orders,
// Order Items and Customers can each be attributed to the counter they came
// through; the catalog (products, modifiers) stays Organization-wide, not
// per-store.
//
// RLS-protected like any ordinary Organization-scoped table (see
// tenantIsolationPolicy below) — NOT exempt the way `organizations`/`members`
// are, because by the time this is queried the Organization scope is already
// established. The one place that reads it before that point
// (getCurrentUser(), resolving the session's active store) reads
// `member_stores` only, never this table directly — see its comment.
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: storeStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stores_organization_id_idx").on(table.organizationId),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// The person. Deliberately NOT the membership — a Supplier sourcing for two
// resellers is one user with two `members` rows. Email is globally unique
// because it identifies a person, not a person-within-an-Organization.
//
// No password here: better-auth stores credentials on `accounts`, with
// providerId in the `local:credential` namespace.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // Platform-level administration — us, the operator. NOT the functional
    // role, which lives on `members.role`. Two deliberately separate axes;
    // see docs/plans/better-auth-migration.md §3. Left null in practice:
    // admins are allowlisted by id via PLATFORM_ADMIN_USER_IDS instead, so
    // there is no in-app path to granting yourself platform admin.
    role: text("role"),
    // Set whenever a password was chosen by someone other than its owner —
    // account creation, or an Admin resetting a forgotten one. Cleared by a
    // successful self-service change. This is what stops an Admin keeping
    // standing access to a colleague's account via the password they issued.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

// Credentials and linked provider accounts. `password` holds the argon2id
// hash — the same format as the old users.password_hash, moved verbatim, so
// migrating users are never asked to reset.
//
// `issuer` is required and carries a unique index with accountId. It is
// missing from output produced by older better-auth CLI versions; omitting
// it breaks credential sign-in.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_issuer_account_id_unique").on(table.issuer, table.accountId),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

// Which Organization a person belongs to, and what they do there. Role is
// text rather than a pg enum because better-auth writes comma-separated
// values for a multi-role member, which an enum cannot hold. `AppRole` in
// src/lib/auth is the real union, and what gives compile-time safety.
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    // Suspended members keep their row — and therefore every Order and
    // Product they created stays attributable — but resolve to no session
    // for this Organization. Removal is a separate, harder action.
    status: memberStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("members_organization_user_unique").on(table.organizationId, table.userId),
    index("members_organization_id_idx").on(table.organizationId),
    index("members_user_id_idx").on(table.userId),
  ],
);

// Which Stores a member can work in — an explicit grant, set by the Admin
// when the person is added (or edited) rather than inferred. A member with
// no row here has no store to work in at all; one row is the common case,
// two or more is what makes the Settings store switcher appear (see
// src/lib/auth's listMemberStores).
//
// RLS-exempt, alongside `members` — getCurrentUser() must read this to
// resolve the session's active store *before* the Organization scope is
// established, so it cannot be gated on that scope. Every query against it
// filters by member_id (itself already resolved inside an org-scoped
// lookup) by hand instead.
export const memberStores = pgTable(
  "member_stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("member_stores_member_store_unique").on(table.memberId, table.storeId),
    index("member_stores_member_id_idx").on(table.memberId),
    index("member_stores_store_id_idx").on(table.storeId),
  ],
);

// Required by the organization plugin. Invitations are deferred from MVP
// (ADR-0002) — the table exists so the plugin's schema validates, and stays
// empty until the feature is built. Settle its RLS story then: it is
// tenant-scoped, but also read pre-auth when accepting.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitations_organization_id_idx").on(table.organizationId),
    index("invitations_email_idx").on(table.email),
  ],
);

// Backs the session cookie. `token` is stored as better-auth issues it —
// see docs/research/better-auth-spike.md §2 for why that is a downgrade from
// the hash-only column it replaces, and why it was accepted.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    // The active Organization — the seam that makes one person able to work
    // in several. src/lib/tenancy.ts reads this, not users.organization_id
    // (which no longer exists). ADR-0002 decision 3.
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id),
    // The active Store, one level down from activeOrganizationId above —
    // but NOT a better-auth field (no plugin owns the concept of a store).
    // Unlike activeOrganizationId, nothing in src/lib/auth trusts this
    // column at face value: getCurrentUser() re-validates it against the
    // member's actual member_stores grants on every request and falls back
    // to their sole store when it has none to trust, so a stale or
    // tampered value here can, at worst, resolve to no active store — never
    // to one the member isn't granted. Written only via direct Drizzle
    // updates (setActiveStore in src/lib/auth), the same way
    // users.mustChangePassword is — never through auth.api.*.
    activeStoreId: uuid("active_store_id").references(() => stores.id),
    // Set by the admin plugin while a platform admin is acting as someone
    // else. Deleted with the session, which is why impersonationEvents below
    // exists as a durable record.
    impersonatedBy: uuid("impersonated_by").references(() => users.id),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

// Email verification and password-reset tokens. Unused until those flows
// ship, but the plugin expects the table.
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

// Append-only audit of support impersonation. Not part of better-auth:
// `sessions.impersonated_by` disappears when the impersonated session ends,
// which is exactly the wrong property for a record of one company's staff
// reading another company's customer data. Nothing in the app deletes from
// this table.
export const impersonationEvents = pgTable(
  "impersonation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => users.id),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("impersonation_events_admin_idx").on(table.adminUserId, table.startedAt)],
);

// A real, searchable entity (docs/PRD.md §5.3) — not free text on the
// order. Created inline while logging an order (search-or-create).
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Which counter this Customer walked into. Denormalized rather than a
    // tag-only concept — see stores' own comment — so every query that lists
    // or searches Customers can filter by it directly. Not itself an RLS
    // clause: organizationId above is still the only tenant boundary.
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    // Nullable at the DB level even though the create-customer form
    // requires it (docs/PRD.md §5.3) — a handful of test customers
    // predate this field. Every customer created going forward will have
    // one; this just avoids inventing a fake backfill value for the ones
    // that don't.
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("customers_organization_store_name_idx").on(table.organizationId, table.storeId, table.name),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// The catalog entry — created once by a Support Agent, reused across
// order items. The `modifiers` JSONB column from the first schema draft is
// gone — modifiers are now relational, see below.
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    // The highest-leverage field — see docs/PRD.md §9.1: lets the Supplier
    // skip manual image search entirely when populated. No separate
    // "source marketplace" field — the URL alone is enough.
    sourceUrl: text("source_url"),
    price: numeric("price", { precision: 12, scale: 2 }),
    status: productStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("products_organization_status_idx").on(table.organizationId, table.status),
    index("products_organization_name_idx").on(table.organizationId, table.name),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// One-to-many, separate table (rather than an array column) so images can
// be ordered and a primary image is unambiguous.
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("product_images_product_sort_idx").on(table.productId, table.sortOrder),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// An organization-wide, reusable attribute type (e.g. "Color") — not typed
// fresh per product. See docs/PRD.md §5.2 / docs/CONTEXT.md.
export const modifiers = pgTable(
  "modifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("modifiers_organization_name_unique").on(table.organizationId, table.name),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// One value within a Modifier (e.g. "Black" within "Color") — the global
// list. A product picks a subset; see productModifierOptions below.
export const modifierOptions = pgTable(
  "modifier_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    modifierId: uuid("modifier_id")
      .notNull()
      .references(() => modifiers.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("modifier_options_modifier_value_unique").on(table.modifierId, table.value),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// Join table: which of a Modifier's global Options actually apply to a
// given Product. Which *Modifiers* a product uses is derivable by joining
// through this table — no separate product<->modifier table needed.
export const productModifierOptions = pgTable(
  "product_modifier_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    modifierOptionId: uuid("modifier_option_id")
      .notNull()
      .references(() => modifierOptions.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("product_modifier_options_unique").on(table.productId, table.modifierOptionId),
    index("product_modifier_options_product_idx").on(table.productId),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// A customer's request, logged by a Support Agent — a header only. No
// status of its own; see orderItems and
// docs/adr/0001-order-item-lifecycle-and-packing.md for why.
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Which counter took this Order — set from the session's active store at
    // save time (services/orders.ts), never user-entered. See stores' own
    // comment for why this is a plain column, not a second RLS clause.
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    screenshotUrl: text("screenshot_url"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Null = still a draft, composed via the order wizard (customer picked,
    // zero or more items added) but not yet handed off — a draft's items
    // don't need to be pending demand the Supplier acts on yet. Set once
    // "Place order" is used; that's also the moment items start counting
    // toward the Purchase Queue in practice (they're only inserted then).
    placedAt: timestamp("placed_at", { withTimezone: true }),
  },
  (table) => [
    index("orders_organization_customer_idx").on(table.organizationId, table.customerId),
    // `id` is part of the key because the Order log pages by keyset on
    // (created_at, id) — see fetchOrdersPage. created_at alone isn't unique,
    // so the sort it defines isn't total and a cursor on it drops or repeats
    // rows exactly at a page boundary. Including id here lets Postgres serve
    // the row-wise comparison and the ORDER BY from one index scan. storeId
    // leads the same way organizationId does — a log scoped to one store rides
    // this index.
    index("orders_organization_store_created_idx").on(
      table.organizationId,
      table.storeId,
      table.createdAt,
      table.id,
    ),
    // The cross-store view of the log — an Admin granted 2+ Stores with the
    // Store filter left on "All stores" — pages by the same keyset with no
    // single store to lead the scan. This one serves that ORDER BY directly,
    // where the store-led index above would merge a slice per store.
    index("orders_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// One line of an order — a product + a modifier-option combination (see
// orderItemModifiers) + quantity. Carries its OWN status, independently of
// every other item on the same order: the Supplier's Purchase Queue
// batches items by product across many different orders/customers at
// once, not by whole order, so status can't live on `orders`.
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // Denormalized from orders.storeId at insert time (services/orders.ts),
    // same reasoning as organizationId above (DATA_MODEL §4): the Purchase
    // and Packing Queues group these across many orders at once, so the
    // column needs to be here directly rather than joined back through
    // orders on every query.
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull().default(1),
    status: orderItemStatusEnum("status").notNull().default("pending"),
    cancellationReason: text("cancellation_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Powers the Purchase Queue: group pending items by product, within one
    // store, across every order/customer.
    index("order_items_org_store_product_status_idx").on(
      table.organizationId,
      table.storeId,
      table.productId,
      table.status,
    ),
    // Powers Parcels (the packing queue) and general order-log filtering.
    index("order_items_org_store_status_created_idx").on(
      table.organizationId,
      table.storeId,
      table.status,
      table.createdAt,
    ),
    index("order_items_org_order_idx").on(table.organizationId, table.orderId),
    tenantIsolationPolicy(),
  ],
).enableRLS();

// Join table: which Modifier Option(s) were selected for this line — e.g.
// Color=Black *and* Size=M on the same item.
export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierOptionId: uuid("modifier_option_id")
      .notNull()
      .references(() => modifierOptions.id),
  },
  (table) => [
    uniqueIndex("order_item_modifiers_unique").on(table.orderItemId, table.modifierOptionId),
    index("order_item_modifiers_item_idx").on(table.orderItemId),
    tenantIsolationPolicy(),
  ],
).enableRLS();
