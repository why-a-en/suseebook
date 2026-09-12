import { Resend } from "resend";
import { appBaseURL } from "@/lib/app-url";

// Outbound transactional mail, via Resend (docs/adr/0006-transactional-email.md).
// Two messages: an invitation link for someone joining a Store, and (only on
// an Admin-initiated reset) a generated temporary password. Keep this module
// the single place that talks to Resend.

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const lead = `Hi ${name}, an administrator has reset your SuSeeOS password for ${organizationName}.`;

  const text = [
    lead,
    "",
    `Sign in at: ${loginUrl}`,
    `Email:    ${to}`,
    `Password: ${temporaryPassword}`,
    "",
    "You'll be asked to choose a new password the first time you sign in.",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:520px">
  <p>${escapeHtml(lead)}</p>
  <table cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse">
    <tr><td style="padding:4px 16px 4px 0;color:#6b6b6b">Email</td><td style="padding:4px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(to)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b6b6b">Password</td><td style="padding:4px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.5px">${escapeHtml(temporaryPassword)}</td></tr>
  </table>
  <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Sign in</a></p>
  <p style="color:#6b6b6b;font-size:13px;margin-top:20px">You'll be asked to choose a new password the first time you sign in. If you weren't expecting this, you can ignore this email.</p>
</div>`;

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
  const lead = `You've been invited to join ${storeName} on SuSeeOS as ${roleLabel}.`;
  const tail = inviterName
    ? `This invite was sent by ${inviterName}. If you weren't expecting it, you can ignore this email.`
    : "If you weren't expecting this, you can ignore this email.";

  const text = [lead, "", `Accept your invitation: ${url}`, "", "You'll choose your own password when you accept.", tail].join("\n");

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:520px">
  <p>${escapeHtml(lead)}</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Accept invitation</a></p>
  <p style="color:#6b6b6b;font-size:13px;margin-top:20px">You'll choose your own password when you accept. ${escapeHtml(tail)}</p>
</div>`;

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
