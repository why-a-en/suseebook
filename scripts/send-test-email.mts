// Sends one sample email through the real Resend path, so you can eyeball
// the layout and confirm RESEND_API_KEY + the sending domain work. Does not
// touch the database.
//
//   pnpm email:test you@example.com
//   pnpm email:test you@example.com reset
//   EMAIL_FROM="SuSeeOS <onboarding@resend.dev>" pnpm email:test you@example.com
//
// Until suseeos.com is a verified sending domain in the Resend dashboard, the
// default From (support@suseeos.com) is rejected with a 403. To test before
// verifying: set EMAIL_FROM to onboarding@resend.dev and send to the email
// address your Resend account is registered under — Resend allows that one
// combination unverified.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const [to, kind = "invite"] = process.argv.slice(2);

if (!to || !["invite", "reset"].includes(kind)) {
  console.error("Usage: pnpm email:test <recipient> [invite|reset]");
  process.exit(1);
}

// After loadEnv so send.ts reads EMAIL_FROM / RESEND_API_KEY with the file applied.
const { sendInvitationEmail, sendCredentialsEmail } = await import("../src/lib/email/send");

if (kind === "invite") {
  await sendInvitationEmail({
    to,
    storeName: "Acme Resale",
    roleLabel: "Support Agent",
    // Not a real invitation id — fine for eyeballing layout and delivery;
    // the link itself 404s on /invite/accept without a matching row.
    token: "00000000-0000-0000-0000-000000000000",
    inviterName: "Test Admin",
  });
} else {
  await sendCredentialsEmail({
    to,
    name: "Test Person",
    temporaryPassword: "wnpy4rtk9mqk",
    organizationName: "Acme Resale",
  });
}

console.log(`Sent a "${kind}" email to ${to}.`);
console.log("Check the inbox, and the Emails log at https://resend.com/emails");
process.exit(0);
