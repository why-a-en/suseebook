import { Button, Heading, Hr, Text } from "react-email";
import { EmailLayout } from "./layout";
import { brand } from "./brand";

export interface InvitationEmailProps {
  /** The Store they're being invited to. */
  storeName: string;
  /** "Admin" / "Support Agent" / "Supplier" — already display-cased. */
  roleLabel: string;
  /** The full accept-invitation link (token already applied). */
  url: string;
  /** Who sent it, for the "you weren't expecting this" line. Optional. */
  inviterName?: string;
}

/**
 * Invites someone to a Store. Rendered by src/lib/email/send.ts —
 * see docs/adr/0006-transactional-email.md.
 */
export function InvitationEmail({
  storeName,
  roleLabel,
  url,
  inviterName,
}: InvitationEmailProps) {
  return (
    <EmailLayout
      preview={`You're invited to join ${storeName} on SuSeeOS`}
      kicker="Invitation"
    >
      <Heading
        as="h1"
        style={{
          margin: "0 0 12px",
          fontSize: 20,
          lineHeight: "26px",
          fontWeight: 700,
          color: brand.ink,
        }}
      >
        Join {storeName}
      </Heading>
      <Text style={{ margin: "0 0 24px", fontSize: 15, lineHeight: "22px", color: brand.body }}>
        You&rsquo;ve been invited to join <strong>{storeName}</strong> on
        SuSeeOS as <strong>{roleLabel}</strong>.
      </Text>

      <Button
        href={url}
        style={{
          display: "inline-block",
          backgroundColor: brand.ink,
          color: brand.inkInvert,
          fontSize: 15,
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 28px",
          borderRadius: 8,
        }}
      >
        Accept invitation
      </Button>

      <Hr style={{ margin: "28px 0 16px", borderColor: brand.hairline }} />

      <Text style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: brand.muted }}>
        You&rsquo;ll choose your own name and password when you accept. This
        invitation expires in 7 days.
      </Text>
      <Text style={{ margin: "8px 0 0", fontSize: 13, lineHeight: "20px", color: brand.muted }}>
        {inviterName ? `Sent by ${inviterName}. ` : ""}
        If you weren&rsquo;t expecting this, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
}

InvitationEmail.PreviewProps = {
  storeName: "Acme Resale",
  roleLabel: "Support Agent",
  url: "https://app.suseeos.com/invite/accept?token=00000000-0000-0000-0000-000000000000",
  inviterName: "Jordan Lee",
} satisfies InvitationEmailProps;

export default InvitationEmail;
