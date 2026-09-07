"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CheckboxField } from "@/components/ui/checkbox";
import type { Store } from "@/services/stores";
import type { AppRole } from "@/services/types";
import { createFirstStoreAction, addFirstStaffAction, finishOnboardingAction } from "./actions";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "support_agent", label: "Support" },
  { value: "supplier", label: "Supplier" },
  { value: "admin", label: "Admin" },
];

export function OnboardingSteps({ stores }: { stores: Store[] }) {
  return stores.length === 0 ? <CreateStoreStep /> : <AddStaffStep stores={stores} />;
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

function AddStaffStep({ stores }: { stores: Store[] }) {
  const [role, setRole] = useState<AppRole>("support_agent");
  const [storeIds, setStoreIds] = useState<string[]>(() => stores.map((s) => s.id));
  const [state, formAction, pending] = useActionState(addFirstStaffAction, undefined);

  if (state?.temporaryPassword) {
    return (
      <div className="grid gap-4">
        <p className="font-ui text-small text-text-body">
          Give this to <span className="font-medium">{state.email}</span>. It is shown once,
          and they must replace it the first time they sign in.
        </p>
        <p className="rounded-md border border-line-hairline bg-surface-raised px-4 py-3 text-center font-mono text-code tracking-label select-all">
          {state.temporaryPassword}
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
      <Field label="Name" required>
        <Input name="name" autoComplete="off" placeholder="Aung Aung" />
      </Field>
      <Field label="Email" required>
        <Input name="email" type="email" autoComplete="off" icon="at-sign" placeholder="name@example.com" />
      </Field>
      <Field label="Role" required>
        <SegmentedControl options={ROLE_OPTIONS} value={role} onChange={setRole} />
        <input type="hidden" name="role" value={role} />
      </Field>
      {/* One Store at this point in onboarding, so nothing to choose — its
          id still has to reach the server. If the Admin has already added a
          second Store, the picker appears. */}
      {stores.length > 1 ? (
        <Field label="Stores" required>
          <div className="grid gap-1">
            {stores.map((s) => (
              <CheckboxField
                key={s.id}
                name="storeIds"
                value={s.id}
                checked={storeIds.includes(s.id)}
                onCheckedChange={(checked) =>
                  setStoreIds((prev) => (checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                }
              >
                {s.name}
              </CheckboxField>
            ))}
          </div>
        </Field>
      ) : (
        storeIds.map((id) => <input key={id} type="hidden" name="storeIds" value={id} />)
      )}
      {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
      <Button full type="submit" disabled={pending} icon="user-plus">
        {pending ? "Adding…" : "Add teammate"}
      </Button>
    </form>
  );
}
