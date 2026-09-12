// Idempotent test-data seed — the accounts the login page's dev helper
// lists. Run it as often as you like; it converges to the state below.
//
//   pnpm tsx scripts/seed-test-data.mts
//
// Scenarios covered (all password `password123`). Store is the tenant now
// (ADR-0005 Phase 3) — every "Store" below is one `organizations` row, no
// sub-Store layer underneath it:
//
//   admin@test.local     Test Store · admin
//                        -> straight in, no switcher
//   cs@test.local        Test Store · support_agent
//                        -> straight in, no switcher
//   cs2@test.local       Second Reseller · support_agent
//   supplier@test.local  Test Store AND Second Reseller · supplier
//                        -> the Store switcher in Settings
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const { auth } = await import("../src/lib/auth/config");
const { db } = await import("../src/db/client");
const { organizations, members, users } = await import("../src/db/schema");
const { and, eq } = await import("drizzle-orm");

const PASSWORD = "password123";

// --- helpers --------------------------------------------------------------

async function ensureStore(name: string, slug: string): Promise<string> {
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [store] = await db.insert(organizations).values({ name, slug }).returning({ id: organizations.id });
  console.log(`+ store "${name}"`);
  return store.id;
}

async function ensureUser(email: string, fullName: string): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing.id;
  // Through better-auth so the credential account matches sign-in exactly.
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: fullName } });
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`failed to create ${email}`);
  console.log(`  + user ${email}`);
  return user.id;
}

/** Upserts the membership — the whole grant now that Store has no
 *  sub-level of its own to also grant. */
async function grant(storeId: string, userId: string, role: string) {
  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.organizationId, storeId)))
    .limit(1);
  if (existing) {
    await db.update(members).set({ role }).where(eq(members.id, existing.id));
  } else {
    await db.insert(members).values({ organizationId: storeId, userId, role });
  }
}

// --- cleanup: leftover test-run orgs (staff-*, orders-*, isolation-*, …) -

const junk = (await db.select().from(organizations)).filter((o) =>
  /^(staff|orders|isolation|customers|invite)-\d+/.test(o.slug),
);
for (const o of junk) {
  await db.delete(members).where(eq(members.organizationId, o.id));
  await db.delete(organizations).where(eq(organizations.id, o.id));
  console.log(`- cleaned leftover org "${o.slug}"`);
}

// --- Test Store: the everyday admin + support scenario --------------------

const testStore = await ensureStore("Test Store", "test-store");
await grant(testStore, await ensureUser("admin@test.local", "Test Admin"), "admin");
await grant(testStore, await ensureUser("cs@test.local", "Test Support"), "support_agent");

// --- Second Reseller: a second tenant, plus a Supplier shared with the
//     first — the case the Store switcher in Settings exists for. ---------

const secondStore = await ensureStore("Second Reseller", "second-reseller");
await grant(secondStore, await ensureUser("cs2@test.local", "Second Support"), "support_agent");

const supplierId = await ensureUser("supplier@test.local", "Shared Supplier");
await grant(testStore, supplierId, "supplier");
await grant(secondStore, supplierId, "supplier");

console.log("\nDone.");
process.exit(0);
