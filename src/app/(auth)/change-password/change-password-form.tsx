"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, undefined);

  return (
    <form action={formAction} className="grid gap-4">
      <Field label={forced ? "Temporary password" : "Current password"} required>
        <Input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          icon="lock"
          placeholder="••••••••"
        />
      </Field>
      <Field label="New password" required hint="At least 8 characters.">
        <Input name="newPassword" type="password" autoComplete="new-password" icon="lock" placeholder="••••••••" />
      </Field>
      <Field label="Confirm new password" required>
        <Input name="confirmPassword" type="password" autoComplete="new-password" icon="lock" placeholder="••••••••" />
      </Field>
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
