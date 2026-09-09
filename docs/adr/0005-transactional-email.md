---
status: accepted
---

# Transactional email: credentials are delivered, not read off the screen

[ADR-0003](./0003-password-recovery-and-forced-change.md) built the whole
credential flow around *not having an email provider*: an Admin generates a
temporary password, reads it to the person over the phone or pastes it into
a chat, and the issuing screen stays open because it holds the only copy.
[ADR-0002](./0002-multi-tenancy-mvp.md) listed "invitations and password
reset" among the things deferred deliberately.

We now have a sending domain (`suseeos.com`) and a provider (Resend). This
ADR spends it on exactly one thing: getting the generated password to its
owner without a human relay.

## What changes

**The four credential moments email the password instead of displaying it:**

| Flow | Trigger |
|---|---|
| New Organization's first Admin | platform console — `createOrganizationAction` |
| New staff member | Admin, `addStaffAction` |
| First teammate during onboarding | Admin, `addFirstStaffAction` |
| Password reset | Admin, `resetStaffPasswordAction` |

The password is no longer returned to the browser by any of these actions.
The success screen confirms the address it went to, nothing more. Everything
else from ADR-0003 stands: the password is still **generated** not chosen,
still one-time, still never stored in readable form, and the account is
still flagged `must_change_password` so its owner replaces it on first
sign-in.

## Decisions

**1. Recovery stays Admin-initiated. Only the delivery channel changes.**
ADR-0003 rejected self-service "forgot password" because an email address is
not a secret and there was no channel only the owner controls. Emailing a
*reset that an Admin already decided to perform* to the account's own
address introduces no new trust assumption — the Admin is still the check on
*who is asking*. What we are **not** adding is a public "email me a reset
link" form. That remains rejected for ADR-0003's reasons.

**2. The address is checked for deliverability before we send.** Every one
of these sends is addressed to a value one person typed for another person.
A typo is a hard bounce, and Resend counts hard bounces against the whole
domain's sender reputation. So `assertDeliverableEmail()`
(`src/lib/email/address.ts`) runs in the action *before* the service creates
anything: RFC-5322-ish syntax, a small disposable-domain blocklist, then a
DNS lookup for an MX record (falling back to A/AAAA per RFC 5321 §5). No
SMTP `RCPT TO` probe — unreliable, and Vercel blocks outbound port 25 — and
no paid verification API. The DNS lookup has a 4 s timeout and **fails
closed**: an address we could not verify is refused, not sent.

**3. The check runs in the action, never in a service transaction.** The
services own a `db.transaction`; a DNS round-trip or an HTTPS call to Resend
inside one holds a pooled connection open for its whole duration. The
services keep only a synchronous syntax guard (the shared
`isValidEmailSyntax`); the action does deliverability up front and the send
afterwards.

**4. A failed send is surfaced, and the password is not shown as a
fallback.** By the time Resend is called the account already exists (it is
created in the service's transaction, which has committed). If the send
throws, the action returns an error telling the Admin the account was
created but the invitation did not go out, and to use **Reset password** to
try again. We deliberately do not fall back to printing the password on
screen — that would re-introduce the exact surface this ADR removes, for the
sake of a path that only opens when email is already misconfigured.

**5. One module talks to Resend.** `src/lib/email/send.ts` — lazily
constructs the client (so a build or a script without `RESEND_API_KEY` does
not throw on import), owns the `From` header
(`SuSeeOS <support@suseeos.com>`, override with `EMAIL_FROM`), and builds
both the text and HTML parts. The sign-in link is built from `appBaseURL()`
(`src/lib/app-url.ts`), which mirrors better-auth's own base-URL resolution
because feature code may not import the auth config.

## Operational prerequisites

- `suseeos.com` verified as a sending domain in the Resend dashboard — SPF
  and DKIM DNS records published. Nothing sends until this is done.
- `RESEND_API_KEY` set in every environment (local `.env.local`, Vercel
  Preview + Production). Without it the server still boots; the four flows
  above fail at the send step with decision 4's error.
- Optionally `APP_BASE_URL` per environment, so the emailed sign-in link
  points at the right origin (staging vs production). Falls back to
  `BETTER_AUTH_URL`, then the Vercel host, then localhost.

## Still deferred

Bounce/complaint webhooks and a local suppression list, delivery-status
visibility in the platform console, any non-credential email (digests,
notifications), and tenant-facing self-serve signup. None of these
constrains the schema or this module's shape.
