// Provisions a new Store and its first staff account.
//
// A Store IS the tenant now (ADR-0005 Phase 3) — this used to also create a
// sub-Store row underneath the Organization it provisioned; that layer is
// gone, so this just creates the tenant and its first member.
//
// This remains a script rather than a signup screen (docs/adr/0002 decision
// 10) for the same reason it always was — Platform Admin provisioning is a
// deliberate, audited act, and `/platform` is the in-app equivalent for
// everyday use. This is the CLI escape hatch.
//
//   pnpm store:create "Acme Resale" cs@acme.com "Aung Aung" <password> support_agent
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

// Dynamic, and after loadEnv() — ESM hoists static imports above all other
// top-level code, so a static import would run db/client.ts's
// `if (!DATABASE_URL) throw` before loadEnv() ever populated it.
const { auth } = await import("../src/lib/auth/config");
const { db } = await import("../src/db/client");
const { organizations, members, users } = await import("../src/db/schema");
const { eq } = await import("drizzle-orm");

const [name, email, fullName, password, role = "support_agent"] = process.argv.slice(2);

if (!name || !email || !fullName || !password) {
  console.error(
    'Usage: pnpm store:create "<Store>" <email> "<Full Name>" <password> [admin|support_agent|supplier]',
  );
  process.exit(1);
}

if (role !== "admin" && role !== "support_agent" && role !== "supplier") {
  console.error(`Unknown role "${role}" — expected admin, support_agent or supplier.`);
  process.exit(1);
}

const slug = name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const [existingStore] = await db
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.slug, slug))
  .limit(1);

if (existingStore) {
  console.error(`A Store with slug "${slug}" already exists.`);
  process.exit(1);
}

const [store] = await db.insert(organizations).values({ name, slug }).returning();

// Through better-auth rather than a direct insert, so the credential account
// is written exactly as sign-in expects it (issuer "local:credential",
// providerId "credential") and the password goes through our argon2 hasher.
await auth.api.signUpEmail({ body: { email, password, name: fullName } });

const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) throw new Error("user was not created");

await db.insert(members).values({ organizationId: store.id, userId: user.id, role });

console.log(`Store "${store.name}" (${store.id}), slug "${store.slug}"`);
console.log(`First member: ${email} as ${role}`);
console.log(`\nAdd more staff with:\n  pnpm member:add <email> ${store.slug} <role>`);

process.exit(0);
