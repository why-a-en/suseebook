---
status: accepted
---

# Admin-issued passwords, forced replacement, and no self-service recovery

> **Amended by [ADR-0005](./0005-transactional-email.md).** The generated
> password is now **emailed** to its owner rather than read off the issuing
> screen — the address is deliverability-checked first, and the actions no
> longer return the password to the browser. Everything else below stands:
> generated-not-chosen, one-time, never stored readable, forced replacement
> on first sign-in, and **no public self-service reset** (an Admin still
> decides every reset; email is only how the result is delivered).

Staff accounts are created by their Organization's Admin, who sets the
password and passes it on directly — there is no invitation email, and
[ADR-0002](./0002-multi-tenancy-mvp.md) defers one deliberately. That makes
two problems, and they have the same shape.

**The Admin knows the password.** Until the owner replaces it, an Admin holds
standing access to a colleague's account, and every action that account takes
is attributable to a person who is not the only one who could have taken it.

**Nobody can recover a forgotten password.** The obvious answer — a
self-service "forgot password" gated on knowing the email address — does not
work, and is worth spelling out because it looks reasonable. An email address
is not a secret: staff addresses are guessable, often printed on invoices,
and shared with customers. Neither is "this account has signed in before" —
it is a property of the account, not knowledge only its owner holds. A reset
gated on those two facts authenticates nobody; it is an open door with a
filter in front of it.

What normally makes a reset safe is that it travels through a channel only
the owner controls. Without an email provider, no such channel exists.

## Decisions

**1. `users.must_change_password` marks a password chosen by someone other
than its owner.** Set on account creation and on an Admin reset; cleared by a
successful self-service change. Framing it this way rather than as "first
login" means the reset path is covered by the same mechanism, with no second
rule to keep in step.

**2. Temporary passwords are generated, not chosen.** Left to type one, an
Admin picks the same weak password for everybody. The alphabet omits
characters that get misheard or misread — no `0`/`O`, `1`/`l`/`I`, `5`/`S`,
`8`/`B` — because these are read down a phone line or pasted into a chat.
The value is shown exactly once and never stored in readable form; the
issuing screen stays open displaying it rather than closing over the only
copy.

**3. Recovery is an Admin reset, not self-service.** The person asks their
Admin, who issues a new temporary password. The check is an Admin who knows
who is asking, which is strictly stronger than knowing an email address.

**4. Any Admin may reset any member, including another Admin.** An
Organization with two Admins can recover itself without us. This is the
practical argument for encouraging every Organization to appoint a second
Admin.

**5. Changing a password revokes the account's other sessions.** Someone
changing their password because they believe another person knows it gains
nothing while that person's session stays alive.

**6. Neither the forced change nor `changeOwnPassword` applies while
impersonating.** A platform admin acting as a tenant's user must not be
pushed into a screen that sets that user's password — support access must
not be able to become a lockout.

**7. The change-password screen lives outside the dashboard layout.** The
forced redirect is issued by that layout, so a screen inside it would
redirect to itself. Putting the route in the `(auth)` group makes the loop
structurally impossible rather than avoided by a path check — the same class
of bug as the stale-cookie redirect loop recorded in `src/proxy.ts`.

## Considered and rejected

- **Self-service reset gated on a known email address**, optionally plus
  "has signed in before". Rejected: neither condition is secret, so this
  hands any account to anyone who knows its owner's email.
- **Emailed reset links.** The right answer eventually, and cheap in code —
  better-auth already ships `forget-password` and `reset-password`. Rejected
  for now because the cost is not the code: it needs an email provider, and
  [the compliance research](../research/myanmar-compliance.md) leaves vendor
  eligibility for a Myanmar-registered entity as an open question. Adopting
  one is a decision, not a task.
- **SMS or Viber one-time codes.** Closer to how people here actually
  verify identity, and worth revisiting. Same vendor and compliance cost as
  email, plus more to build.
- **Restricting resets to non-Admin staff.** Safer against a rogue Admin,
  but it makes every forgetful Admin a support ticket for us, and removes
  the ability for an Organization to recover itself.
- **Expiring temporary passwords.** Deferred. The forced change already
  bounds how long one is useful for anything except a first sign-in; a hard
  expiry adds a second clock and a new failure mode ("my password expired
  before I got to it").

## Consequences

**An Organization whose only Admin forgets their password needs us.** There
is no one above them inside the app. Recovery is a script run against the
database. This is the cost of decision 4 having no fallback, and the reason
to push new Organizations towards two Admins.

**A temporary password travels over whatever channel the Admin uses** — a
chat message, or spoken aloud. That is the weakest link in this design and
it is accepted knowingly: the alternative is an email provider we do not
have. Generating the password, showing it once, and forcing its replacement
bound the exposure rather than remove it.

**`assertNotLastAdmin()` in `src/services/staff.ts` is currently
unreachable.** The actor always holds an active Admin membership, so
excluding a different target always leaves at least the actor; the only path
to zero Admins is targeting yourself, which the self-guard refuses first. It
is kept as defence in depth for callers that are not a signed-in Admin — a
script, or a future platform-admin path — and `tests/staff.test.ts` records
why rather than asserting behaviour that cannot happen.
