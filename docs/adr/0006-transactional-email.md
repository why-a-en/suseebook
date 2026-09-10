---
status: accepted
amends: ADR-0002 (invitations no longer deferred), ADR-0003 (delivery channel; must_change_password scope)
---

# Transactional email: invitation links for new members, a temporary password for resets

[ADR-0003](./0003-password-recovery-and-forced-change.md) built the whole
credential flow around *not having an email provider*: an Admin generates a
temporary password, reads it out over the phone or pastes it into a chat,
and the issuing screen stays open because it holds the only copy.
[ADR-0002](./0002-multi-tenancy-mvp.md) listed "invitations and password
reset" among the things deferred deliberately.
[ADR-0005](./0005-store-as-sole-tenant.md) §6 then made **invitations the
only way to join a Store**.

We now have a sending domain (`suseeos.com`) and a provider (Resend). This
ADR spends it on the two messages that flow from those decisions.

## The two sends

| Message | Who gets it | What's in it |
|---|---|---|
| **Invitation** | anyone being added to a Store — a new Admin (from a Platform Admin), a new teammate (from a Store Admin) | a one-time link to `/invite/accept`; the person sets their **own** name and password |
| **Password reset** | an existing member whose Admin reset their password | a **generated** temporary password, `must_change_password` set, replaced on next sign-in |

**New accounts are never issued a generated password.** The invitee chooses
their own on accept, so there is nothing to read off a screen and nothing to
relay. `must_change_password` (ADR-0003) survives only for the reset path —
the one case where someone other than the owner set the password.

The trigger points:

| Flow | Trigger | Send |
|---|---|---|
| New Store's first Admin | platform console — `createOrganizationAction` | invitation |
| New teammate | Admin — `addStaffAction` | invitation |
| First teammate during onboarding | Admin — `addFirstStaffAction` | invitation |
| Password reset | Admin — `resetStaffPasswordAction` | temporary password |

No action returns a password or a token to the browser. The success screen
confirms the address it went to, nothing more.

## Decisions

**1. A reset is still Admin-initiated; only the delivery channel is new.**
ADR-0003 rejected self-service "forgot password" because an email address is
not a secret and there was no channel only the owner controls. Emailing a
*reset an Admin already decided to perform* to the account's own address
adds no new trust assumption — the Admin is still the check on *who is
asking*. We are **not** adding a public "email me a reset link" form; that
stays rejected for ADR-0003's reasons.

**2. The invitation link carries the invitation id as its token.** It is a
random UUID (`defaultRandom()`), and `/invite/accept` re-checks three things
server-side before it does anything: the invitation is still `pending`, it
has not expired, and the signed-in user's email matches the invitation's.
An attacker would need the UUID *and* a session as the exact invited
address. Invitations expire after **7 days** (`invitationExpiresIn`); a
resend issues a fresh row and cancels the old one
(`cancelPendingInvitationsOnReInvite`).

**3. The address is checked for deliverability before we send.** Every send
is addressed to a value one person typed for another. A typo is a hard
bounce, and Resend counts hard bounces against the whole domain's sender
reputation. `assertDeliverableEmail()` (`src/lib/email/address.ts`) runs in
the action *before* the service creates anything: RFC-5322-ish syntax, a
small disposable-domain blocklist, then a DNS lookup for an MX record
(falling back to A/AAAA per RFC 5321 §5). No SMTP `RCPT TO` probe
(unreliable, and Vercel blocks outbound port 25) and no paid verification
API. The lookup has a 4 s timeout and **fails closed** — an address we could
not verify is refused, not sent.

**4. The check runs in the action, never in a service transaction.** The
services own a `db.transaction`; a DNS round-trip or an HTTPS call to Resend
inside one holds a pooled connection open for its whole duration. Services
keep only the synchronous `isValidEmailSyntax` guard; the action does
deliverability up front and the send afterwards.

**5. A failed send is surfaced, and nothing is shown as a fallback.** By the
time Resend is called the `invitations` row (or, for a reset, the new
password hash) is already committed. If the send throws, the action returns
an error telling the Admin the invitation was recorded but did not go out,
and to use **Resend** (or **Reset password**) to try again. We do not fall
back to printing a link or a password on screen — that would re-introduce
the exact surface this ADR removes, for a path that only opens when email is
already misconfigured.

**6. One module talks to Resend.** `src/lib/email/send.ts` — lazily
constructs the client (so a build or a script without `RESEND_API_KEY` does
not throw on import), owns the `From` header
(`SuSeeOS <support@suseeos.com>`, override with `EMAIL_FROM`), and builds
both the text and HTML parts of each message. Links are built from
`appBaseURL()` (`src/lib/app-url.ts`), which mirrors better-auth's own
base-URL resolution because feature code may not import the auth config.

## Operational prerequisites

- `suseeos.com` verified as a sending domain in Resend — SPF and DKIM DNS
  records published. Nothing sends until this is done.
- `RESEND_API_KEY` set in every environment (local `.env.local`, Vercel
  Preview + Production). Without it the server still boots; the flows above
  fail at the send step with decision 5's error.
- Optionally `APP_BASE_URL` per environment so links point at the right
  origin (staging vs production). Falls back to `BETTER_AUTH_URL`, then the
  Vercel host, then localhost.

## Still deferred

Bounce/complaint webhooks and a local suppression list, delivery-status
visibility in the platform console, any non-credential email (digests,
notifications), and tenant-facing self-serve signup. None constrains the
schema or this module's shape.
