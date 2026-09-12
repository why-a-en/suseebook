// Adds an existing person to another Store.
//
// This is the script that makes a shared Supplier work — one sourcer buying
// for several resellers, with one login rather than an email address per
// client (docs/adr/0002-multi-tenancy-mvp.md). If the person is new to the
// platform entirely, pass a password and an account is created for them.
//
// A Store IS the tenant now (ADR-0005 Phase 3) — there is no sub-Store grant
// to also pick, so this is just `(email, store, role)`.
//
//   pnpm member:add supplier@example.com acme-resale supplier
//   pnpm member:add newperson@example.com acme-resale supplier "Full Name" <password>
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const { auth } = await import("../src/lib/auth/config");
const { db } = await import("../src/db/client");
const { organizations, members, users } = await import("../src/db/schema");
const { and, eq } = await import("drizzle-orm");

const [email, storeSlug, role, fullName, password] = process.argv.slice(2);

if (!email || !storeSlug || !role) {
  console.error(
    'Usage: pnpm member:add <email> <store-slug> <admin|support_agent|supplier> ["Full Name" <password>]',
  );
  process.exit(1);
}

if (role !== "admin" && role !== "support_agent" && role !== "supplier") {
  console.error(`Unknown role "${role}" — expected admin, support_agent or supplier.`);
  process.exit(1);
}

const [store] = await db
  .select()
  .from(organizations)
  .where(eq(organizations.slug, storeSlug))
  .limit(1);

if (!store) {
  console.error(`No Store with slug "${storeSlug}".`);
  process.exit(1);
}

let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

if (!user) {
  if (!fullName || !password) {
    console.error(
      `No user with email "${email}". To create one, pass a full name and password as well.`,
    );
    process.exit(1);
  }
  await auth.api.signUpEmail({ body: { email, password, name: fullName } });
  [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error("user was not created");
  console.log(`Created account for ${email}`);
}

const [existing] = await db
  .select({ id: members.id })
  .from(members)
  .where(and(eq(members.userId, user.id), eq(members.organizationId, store.id)))
  .limit(1);

if (existing) {
  console.error(`${email} is already a member of "${store.name}".`);
  process.exit(1);
}

await db.insert(members).values({ organizationId: store.id, userId: user.id, role });

console.log(`Added ${email} to "${store.name}" as ${role}.`);
console.log("They can switch between Stores from Settings.");

process.exit(0);
