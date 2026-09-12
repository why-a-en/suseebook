import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";
import type { ReactNode } from "react";
import { brand, FONT_MONO, FONT_SANS } from "./brand";

/**
 * The one wrapper every outbound email goes through: wordmark header, a
 * white card, a muted footer. Individual messages (invitation.tsx,
 * credentials.tsx) only ever render what goes *inside* the card.
 */
export function EmailLayout({
  preview,
  kicker,
  children,
}: {
  /** Inbox preview-line text — seen before the email is opened. */
  preview: string;
  /** Small uppercase mono label above the headline, e.g. "INVITATION". */
  kicker: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        {/* Stops Gmail/Apple Mail's auto dark-mode from repainting a
            palette that's already been chosen deliberately (brand.ts). */}
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: brand.page,
          margin: 0,
          padding: "32px 16px",
          fontFamily: FONT_SANS,
          WebkitTextSizeAdjust: "100%",
        }}
      >
        <Container style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}>
          {/* wordmark */}
          <Row style={{ marginBottom: 20 }}>
            <Column style={{ width: 28 }}>
              <table cellPadding={0} cellSpacing={0} role="presentation">
                <tbody>
                  <tr>
                    <td
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        backgroundColor: brand.ink,
                        textAlign: "center",
                        verticalAlign: "middle",
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        fontWeight: 700,
                        color: brand.inkInvert,
                        lineHeight: "22px",
                      }}
                    >
                      S
                    </td>
                  </tr>
                </tbody>
              </table>
            </Column>
            <Column>
              <Text
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                  color: brand.ink,
                }}
              >
                SuSeeOS
              </Text>
            </Column>
          </Row>

          {/* card */}
          <Section
            style={{
              backgroundColor: brand.card,
              border: `1px solid ${brand.hairline}`,
              borderRadius: 12,
              padding: "32px 28px",
            }}
          >
            <Text
              style={{
                margin: "0 0 8px",
                fontFamily: FONT_MONO,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: brand.faint,
              }}
            >
              {kicker}
            </Text>
            {children}
          </Section>

          {/* footer */}
          <Section style={{ padding: "20px 4px 0" }}>
            <Text
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: "18px",
                color: brand.faint,
              }}
            >
              Automated message from SuSeeOS — reach us at{" "}
              <Link
                href="mailto:support@suseeos.com"
                style={{ color: brand.faint, textDecoration: "underline" }}
              >
                support@suseeos.com
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
