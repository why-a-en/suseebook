"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { startImpersonationAction } from "./actions";

/**
 * A client component only so the action's error can be shown inline — the
 * same shape the login form uses. The server-rendered version threw instead,
 * which meant a typo in the email produced Next's full-page runtime error
 * and no way back to the form.
 */
export function ImpersonateForm() {
  const [state, formAction, pending] = useActionState(startImpersonationAction, undefined);

  return (
    <form action={formAction} className="grid gap-3 px-5 py-3">
      <Field
        label="View as user"
        required
        hint="Every impersonated session is recorded permanently."
      >
        <Input name="email" type="email" autoComplete="off" placeholder="name@example.com" icon="at-sign" />
      </Field>
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" variant="secondary" icon="user" disabled={pending}>
        {pending ? "Starting…" : "Start impersonating"}
      </Button>
    </form>
  );
}
