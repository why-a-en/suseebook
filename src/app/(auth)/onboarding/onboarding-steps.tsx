"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Store } from "@/services/stores";
import type { AppRole } from "@/services/types";
import { createFirstStoreAction, addFirstStaffAction, finishOnboardingAction } from "./actions";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "support_agent", label: "Support" },
  { value: "supplier", label: "Supplier" },
  { value: "admin", label: "Admin" },
];

export function OnboardingSteps({ stores }: { stores: Store[] }) {
  return stores.length === 0 ? <CreateStoreStep /> : <AddStaffStep />;
}

function CreateStoreStep() {
  const [state, formAction, pending] = useActionState(createFirstStoreAction, undefined);

  return (
    <form action={formAction} className="grid gap-4">
      <Field label="Store name" required>
        <Input name="name" autoComplete="off" placeholder="Yangon Downtown" />
      </Field>
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" disabled={pending} icon="store">
        {pending ? "Creating…" : "Create store"}
      </Button>
    </form>
  );
}

function AddStaffStep() {
  const [role, setRole] = useState<AppRole>("support_agent");
  const [state, formAction, pending] = useActionState(addFirstStaffAction, undefined);

  if (state?.invitedEmail) {
    return (
      <div className="grid gap-4">
        <p className="font-ui text-small text-text-body">
          We&apos;ve sent an invitation to <span className="font-medium">{state.invitedEmail}</span>.
          They&apos;ll set their own name and password when they accept it.
        </p>
        <form action={finishOnboardingAction}>
          <Button full type="submit">
            Go to app
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <Field label="Email" required>
        <Input name="email" type="email" autoComplete="off" icon="at-sign" placeholder="name@example.com" />
      </Field>
      <Field label="Role" required>
        <SegmentedControl options={ROLE_OPTIONS} value={role} onChange={setRole} />
        <input type="hidden" name="role" value={role} />
      </Field>
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" disabled={pending} icon="user-plus">
        {pending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}
