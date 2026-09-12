import { Resend } from "resend";
import { render } from "react-email";
import { appBaseURL } from "@/lib/app-url";
import { CredentialsEmail } from "./templates/credentials";
import { InvitationEmail } from "./templates/invitation";

// Outbound transactional mail, via Resend (docs/adr/0006-transactional-email.md).
// Two messages: an invitation link for someone joining a Store, and (only on
// an Admin-initiated reset) a generated temporary password. Keep this module
// the single place that talks to Resend; the markup itself lives in
// src/lib/email/templates/ as React Email components — this file only
// renders one and hands the result to Resend.

const FROM = process.env.EMAIL_FROM ?? "SuSeeOS <support@suseeos.com>";

let client: Resend | null = null;

// Lazily constructed so importing this file (in a build, a test, a script
// without the key) doesn't throw — only actually sending does.
function resend(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set — cannot send email.");
    client = new Resend(key);
  }
  return client;
}

/** Renders a template element to both parts Resend wants. */
async function renderParts(node: React.ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })]);
  return { html, text };
}

/**
 * Delivers a generated temporary password after an Admin reset it — the
 * only credential this app still issues rather than lets someone choose
 * (docs/adr/0006-transactional-email.md). Every other account-creation path
 * (staff, onboarding's first teammate, a new Organization's first Admin)
 * sends sendInvitationEmail below instead; there used to be "new-admin" and
 * "new-staff" variants here too, and they went with them.
 *
 * Throws on any failure — Resend reports API errors in the result rather
 * than throwing, so we surface those too. The caller decides what the
 * person who triggered it sees; nothing here is retried.
 */
export async function sendCredentialsEmail(input: {
  to: string;
  name: string;
  temporaryPassword: string;
  organizationName: string;
}): Promise<void> {
  const { to, name, temporaryPassword, organizationName } = input;
  const loginUrl = `${appBaseURL()}/login`;

  const { html, text } = await renderParts(
    CredentialsEmail({ to, name, temporaryPassword, organizationName, loginUrl }),
  );

  const { error } = await resend().emails.send({
    from: FROM,
    to: [to],
    subject: "Your SuSeeOS password has been reset",
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend refused the message: ${error.name} — ${error.message}`);
  }
}

/**
 * Invites someone to a Store. The link carries the invitation id as its
 * token; `/invite/accept` re-checks status, expiry and the recipient's email
 * server-side (docs/adr/0006 §2). The invitee sets their own name and
 * password — nothing secret is in this email, so a forward is harmless.
 */
export async function sendInvitationEmail(input: {
  to: string;
  /** The Store they're being invited to. */
  storeName: string;
  /** "Admin" / "Support Agent" / "Supplier" — already display-cased. */
  roleLabel: string;
  /** The invitation id; becomes `?token=` on the accept link. */
  token: string;
  /** Who sent it, for the "you weren't expecting this" line. Optional. */
  inviterName?: string;
}): Promise<void> {
  const { to, storeName, roleLabel, token, inviterName } = input;
  const url = `${appBaseURL()}/invite/accept?token=${encodeURIComponent(token)}`;

  const { html, text } = await renderParts(
    InvitationEmail({ storeName, roleLabel, url, inviterName }),
  );

  const { error } = await resend().emails.send({
    from: FROM,
    to: [to],
    subject: `Join ${storeName} on SuSeeOS`,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend refused the message: ${error.name} — ${error.message}`);
  }
}
