"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(dashboard)/actions";
import { acceptAsCurrentUserAction, acceptAsNewUserAction } from "./actions";

/**
 * Three shapes, decided by who (if anyone) is signed in relative to the
 * invited address — everything the server already resolved is passed in as
 * plain props so this stays a client component without importing
 * `@/lib/auth` (that would drag the DB layer into the client bundle).
 */
export function AcceptView({
  token,
  email,
  organizationName,
  roleLabel,
  hasAccount,
  signedInEmail,
}: {
  token: string;
  email: string;
  organizationName: string;
  roleLabel: string;
  hasAccount: boolean;
  signedInEmail: string | null;
}) {
  const lead = `Join ${organizationName} on SuSeeOS as ${roleLabel}.`;

  // Signed in as someone other than the invitee — including "signed in as
  // the same account" being impossible to reach unless the emails match, so
  // this branch is strictly "wrong account".
  if (signedInEmail && signedInEmail.toLowerCase() !== email.toLowerCase()) {
    return (
      <div className="space-y-4">
        <p className="font-ui text-body-strong text-text-strong">{lead}</p>
        <p className="font-ui text-small text-text-muted">
          You&rsquo;re signed in as <span className="text-text-body">{signedInEmail}</span>, but
          this invitation is for <span className="text-text-body">{email}</span>. Sign out, then
          open this invitation link again from your email to accept it.
        </p>
        <form action={logoutAction}>
          <Button full type="submit" variant="secondary" icon="log-out">
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  // Signed in as the invitee — just confirm.
  if (signedInEmail) {
    return <AcceptAsCurrentUser token={token} lead={lead} />;
  }

  // Not signed in, and the address already has an account elsewhere —
  // signing up again would fail; point them at sign-in instead.
  if (hasAccount) {
    return (
      <div className="space-y-4">
        <p className="font-ui text-body-strong text-text-strong">{lead}</p>
        <p className="font-ui text-small text-text-muted">
          <span className="text-text-body">{email}</span> already has an account. Sign in, then open
          this invitation link again to accept it.
        </p>
        <Link href="/login">
          <Button full icon="log-in">
            Sign in
          </Button>
        </Link>
      </div>
    );
  }

  // Not signed in, no account yet — the common case: set a name and password.
  return <AcceptAsNewUser token={token} email={email} lead={lead} />;
}

function AcceptAsCurrentUser({ token, lead }: { token: string; lead: string }) {
  const [state, formAction, pending] = useActionState(acceptAsCurrentUserAction, undefined);
  return (
    <form action={formAction} className="space-y-4">
      <p className="font-ui text-body-strong text-text-strong">{lead}</p>
      <input type="hidden" name="token" value={token} />
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" disabled={pending} icon="check">
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}

function AcceptAsNewUser({ token, email, lead }: { token: string; email: string; lead: string }) {
  const [state, formAction, pending] = useActionState(acceptAsNewUserAction, undefined);
  return (
    <form action={formAction} className="grid gap-4">
      <p className="font-ui text-body-strong text-text-strong">{lead}</p>
      <input type="hidden" name="token" value={token} />
      <Field label="Email">
        <Input value={email} disabled />
      </Field>
      <Field label="Name" required>
        <Input name="name" autoComplete="name" icon="user" placeholder="Aung Aung" />
      </Field>
      <Field label="Password" required>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          icon="lock"
          placeholder="At least 8 characters"
        />
      </Field>
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" disabled={pending} icon="check">
        {pending ? "Setting up…" : "Accept invitation"}
      </Button>
    </form>
  );
}
