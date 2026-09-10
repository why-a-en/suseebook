// Sends one sample credential email through the real Resend path, so you can
// eyeball the layout and confirm RESEND_API_KEY + the sending domain work
// before wiring up the full create-user flow. Does not touch the database.
//
//   pnpm email:test you@example.com
//   pnpm email:test you@example.com new-admin
//   EMAIL_FROM="SuSeeOS <onboarding@resend.dev>" pnpm email:test you@example.com
//
// Until suseeos.com is a verified sending domain in the Resend dashboard, the
// default From (support@suseeos.com) is rejected with a 403. To test before
// verifying: set EMAIL_FROM to onboarding@resend.dev and send to the email
// address your Resend account is registered under — Resend allows that one
// combination unverified.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const [to, kind = "new-staff"] = process.argv.slice(2);

if (!to || !["new-admin", "new-staff", "reset"].includes(kind)) {
  console.error(
    "Usage: pnpm email:test <recipient> [new-admin|new-staff|reset]",
  );
  process.exit(1);
}

// After loadEnv so send.ts reads EMAIL_FROM / RESEND_API_KEY with the file applied.
const { sendCredentialsEmail } = await import("../src/lib/email/send");

const context = (
  {
    "new-admin": { kind: "new-admin", organizationName: "Acme Resale" },
    "new-staff": { kind: "new-staff", organizationName: "Acme Resale", roleLabel: "Support Agent" },
    reset: { kind: "reset", organizationName: "Acme Resale" },
  } as const
)[kind as "new-admin" | "new-staff" | "reset"];

await sendCredentialsEmail({
  to,
  name: "Test Person",
  temporaryPassword: "wnpy4rtk9mqk",
  context,
});

console.log(`Sent a "${kind}" credential email to ${to}.`);
console.log("Check the inbox, and the Emails log at https://resend.com/emails");
process.exit(0);
