import { Button, Heading, Row, Column, Text } from "react-email";
import { EmailLayout } from "./layout";
import { brand, FONT_MONO } from "./brand";

export interface CredentialsEmailProps {
  to: string;
  name: string;
  temporaryPassword: string;
  organizationName: string;
  loginUrl: string;
}

/**
 * Delivers a generated temporary password after an Admin reset it. Rendered
 * by src/lib/email/send.ts — see docs/adr/0006-transactional-email.md.
 */
export function CredentialsEmail({
  to,
  name,
  temporaryPassword,
  organizationName,
  loginUrl,
}: CredentialsEmailProps) {
  return (
    <EmailLayout preview="Your SuSeeOS password has been reset" kicker="Password reset">
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
        Password reset
      </Heading>
      <Text style={{ margin: "0 0 20px", fontSize: 15, lineHeight: "22px", color: brand.body }}>
        Hi {name}, an administrator reset your SuSeeOS password for{" "}
        <strong>{organizationName}</strong>.
      </Text>

      <table
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        style={{
          width: "100%",
          backgroundColor: brand.sunken,
          border: `1px solid ${brand.hairline}`,
          borderRadius: 8,
          marginBottom: 24,
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "14px 16px" }}>
              <Row>
                <Column style={{ width: 76 }}>
                  <Text style={{ margin: 0, fontSize: 12, color: brand.faint }}>Email</Text>
                </Column>
                <Column>
                  <Text
                    style={{
                      margin: 0,
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      color: brand.ink,
                      wordBreak: "break-all",
                    }}
                  >
                    {to}
                  </Text>
                </Column>
              </Row>
              <Row style={{ marginTop: 8 }}>
                <Column style={{ width: 76 }}>
                  <Text style={{ margin: 0, fontSize: 12, color: brand.faint }}>Password</Text>
                </Column>
                <Column>
                  <Text
                    style={{
                      margin: 0,
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      letterSpacing: "0.02em",
                      color: brand.ink,
                    }}
                  >
                    {temporaryPassword}
                  </Text>
                </Column>
              </Row>
            </td>
          </tr>
        </tbody>
      </table>

      <Button
        href={loginUrl}
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
        Sign in
      </Button>

      <Text style={{ margin: "24px 0 0", fontSize: 13, lineHeight: "20px", color: brand.muted }}>
        You&rsquo;ll be asked to choose a new password the first time you
        sign in. If you weren&rsquo;t expecting this, contact your
        administrator.
      </Text>
    </EmailLayout>
  );
}

CredentialsEmail.PreviewProps = {
  to: "jordan@example.com",
  name: "Jordan Lee",
  temporaryPassword: "wnpy4rtk9mqk",
  organizationName: "Acme Resale",
  loginUrl: "https://app.suseeos.com/login",
} satisfies CredentialsEmailProps;

export default CredentialsEmail;
