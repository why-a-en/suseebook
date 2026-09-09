import { Resend } from "resend";
import { appBaseURL } from "@/lib/app-url";

// Outbound transactional mail, via Resend (docs/adr/0005-transactional-email.md).
// The only messages this app sends are account credentials — a generated
// password that used to be read out on screen and is now delivered here
// instead. Keep this module the single place that talks to Resend.

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

type CredentialContext =
  | { kind: "new-admin"; organizationName: string }
  | { kind: "new-staff"; organizationName: string; roleLabel: string }
  | { kind: "reset"; organizationName: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function subjectFor(ctx: CredentialContext): string {
  switch (ctx.kind) {
    case "new-admin":
      return `Your SuSeeOS admin account for ${ctx.organizationName}`;
    case "new-staff":
      return `You've been added to ${ctx.organizationName} on SuSeeOS`;
    case "reset":
      return `Your SuSeeOS password has been reset`;
  }
}

function leadFor(ctx: CredentialContext, name: string): string {
  const hi = `Hi ${name},`;
  switch (ctx.kind) {
    case "new-admin":
      return `${hi} an account has been created for you to administer ${ctx.organizationName} on SuSeeOS.`;
    case "new-staff":
      return `${hi} you've been added to ${ctx.organizationName} on SuSeeOS as ${ctx.roleLabel}.`;
    case "reset":
      return `${hi} an administrator has reset your SuSeeOS password for ${ctx.organizationName}.`;
  }
}

/**
 * Sends someone their sign-in credentials. Throws on any failure — Resend
 * reports API errors in the result rather than throwing, so we surface those
 * too. The caller decides what the person who triggered it sees; nothing
 * here is retried.
 */
export async function sendCredentialsEmail(input: {
  to: string;
  name: string;
  temporaryPassword: string;
  context: CredentialContext;
}): Promise<void> {
  const { to, name, temporaryPassword, context } = input;
  const loginUrl = `${appBaseURL()}/login`;
  const lead = leadFor(context, name);

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
    subject: subjectFor(context),
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend refused the message: ${error.name} — ${error.message}`);
  }
}
