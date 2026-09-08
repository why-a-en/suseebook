// Provisions a platform operator — one of us, who runs SuSeeOS.
//
// An operator is a `users` row + credential account with **NO tenant
// membership**: no `members` row, no Organization, no tenant role. They live
// only under /platform and reach a client's data by impersonating.
//
// This script only creates the account. To actually make them an operator,
// add the printed id to PLATFORM_ADMIN_USER_IDS (the env is the single
// source of truth — there is no in-app path to becoming one).
//
//   pnpm platform:add ops@suseeos.com "Yan Min" <password>
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const { auth } = await import("../src/lib/auth/config");
const { db } = await import("../src/db/client");
const { users } = await import("../src/db/schema");
const { eq } = await import("drizzle-orm");

const [email, fullName, password] = process.argv.slice(2);

if (!email || !fullName || !password) {
  console.error('Usage: pnpm platform:add <email> "<Full Name>" <password>');
  process.exit(1);
}

const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (existing) {
  console.error(`A user with email "${email}" already exists (id ${existing.id}).`);
  console.error("If they should be an operator, add that id to PLATFORM_ADMIN_USER_IDS.");
  process.exit(1);
}

// Through better-auth so the credential account matches sign-in exactly.
// The password is theirs — no forced change.
await auth.api.signUpEmail({ body: { email, password, name: fullName } });

const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) throw new Error("user was not created");

console.log(`Created operator account: ${email} (${user.id})`);
console.log("\nMake them an operator by adding the id to PLATFORM_ADMIN_USER_IDS:");
console.log(`  PLATFORM_ADMIN_USER_IDS=${user.id}`);
console.log("\n(comma-separated for more than one; restart the app / redeploy after.)");

process.exit(0);
