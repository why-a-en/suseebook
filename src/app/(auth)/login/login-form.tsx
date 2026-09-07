"use client";

import { useActionState, useRef } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginAction } from "./actions";

// Seeded development accounts — the scenario matrix for Organizations and
// Stores. Run `pnpm tsx scripts/seed-test-data.mts` to (re)create them; the
// script's header documents each one. This block is stripped from
// production builds.
const TEST_ACCOUNTS = [
  { email: "admin@test.local", password: "password123", note: "Admin · 2 stores → picks on login, switcher in Settings" },
  { email: "cs@test.local", password: "password123", note: "Support · 1 store → straight in, no switcher" },
  { email: "packer@test.local", password: "password123", note: "Support · Warehouse only → lands on the non-default store" },
  { email: "supplier@test.local", password: "password123", note: "Supplier · 2 orgs, 2 stores → both switchers" },
  { email: "cs2@test.local", password: "password123", note: "Support · Second Reseller" },
  { email: "founder@test.local", password: "password123", note: "Admin · org has no store → /onboarding" },
  { email: "orphan@test.local", password: "password123", note: "Support · no store granted → /select-store dead-end" },
] as const;

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function fillTestAccount(email: string, password: string) {
    if (emailRef.current) emailRef.current.value = email;
    if (passwordRef.current) passwordRef.current.value = password;
  }

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4">
        <Field label="Email" required>
          <Input ref={emailRef} id="email" name="email" type="email" autoComplete="email" icon="at-sign" placeholder="you@example.com" />
        </Field>
        <Field label="Password" required>
          <Input ref={passwordRef} id="password" name="password" type="password" autoComplete="current-password" icon="lock" placeholder="••••••••" />
        </Field>
        {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
        <Button full type="submit" disabled={pending} icon="log-in">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {/* Test-only helper — never shipped in a production build. */}
      {process.env.NODE_ENV !== "production" && (
        <div className="rounded-md border border-line-hairline p-3">
          <p className="font-ui text-small-strong text-text-strong">Test accounts</p>
          <p className="mt-0.5 font-ui text-small text-text-faint">
            All <code className="font-mono text-code">password123</code>. Each covers a
            different Organization / Store scenario.
          </p>
          <ul className="mt-3 grid gap-2.5">
            {TEST_ACCOUNTS.map((account) => (
              <li key={account.email} className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-ui text-small text-text-body">
                  <code className="font-mono text-code">{account.email}</code>
                  <span className="block text-small text-text-faint">{account.note}</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => fillTestAccount(account.email, account.password)}
                >
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
