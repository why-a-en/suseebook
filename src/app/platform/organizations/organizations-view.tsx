"use client";

import { useActionState, useState } from "react";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { Icon } from "@/components/icon";
import type { OrganizationSummary } from "@/services/platform";
import { createOrganizationAction } from "./actions";

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OrganizationsView({
  organizations,
}: {
  organizations: OrganizationSummary[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <Screen>
      <TopBar backHref="/platform" title="Stores" eyebrow="Operator" />
      <ScrollBody>
        <SectionHeader right={`${organizations.length}`}>All Stores</SectionHeader>

        {organizations.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No Stores yet."
            body="Create one below — it provisions the Store and invites its first Admin."
          />
        ) : (
          organizations.map((org) => (
            <Row key={org.id} href={`/platform/organizations/${org.id}`}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{org.name}</span>
                <span className="truncate font-ui text-small text-text-faint">
                  {org.memberCount} member{org.memberCount === 1 ? "" : "s"} · {formatDate(org.createdAt)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {org.status === "suspended" && (
                  <span className="font-ui text-small text-danger">Suspended</span>
                )}
                <Icon name="chevron-right" size={16} className="text-text-faint" />
              </div>
            </Row>
          ))
        )}

        <div className="px-5 pt-5 pb-8">
          <Button full variant="secondary" icon="plus" onClick={() => setCreating(true)}>
            New Store
          </Button>
        </div>
      </ScrollBody>

      <NewOrgSheet open={creating} onOpenChange={setCreating} />
    </Screen>
  );
}

function NewOrgSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Fresh form (and fresh useActionState) on every open, so a previous
          submit's one-time password is never still on screen. */}
      <SheetContent>{open && <NewOrgForm onDone={() => onOpenChange(false)} />}</SheetContent>
    </Sheet>
  );
}

function NewOrgForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(createOrganizationAction, undefined);

  // On success the sheet stays open on a confirmation — an invitation link
  // has been emailed; nothing about the Admin exists yet beyond that.
  if (state?.invitedEmail) {
    return (
      <>
        <SheetHeader title="Store created" />
        <SheetBody>
          <div className="grid gap-3">
            <p className="font-ui text-small text-text-body">
              Slug <code className="font-mono text-code">{state.slug}</code>. We&apos;ve sent an
              invitation to <span className="font-medium">{state.invitedEmail}</span>.
            </p>
            <p className="font-ui text-small text-text-faint">
              They&apos;ll set their own name and password on accept, then land straight in — no
              setup left for them to do.
            </p>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button full onClick={onDone}>
            Done
          </Button>
        </SheetFooter>
      </>
    );
  }

  return (
    <>
      <SheetHeader title="New Store" />
      <form action={formAction}>
        <SheetBody className="grid gap-4">
          <Field label="Store name" required hint="The slug is derived from this.">
            <Input name="organizationName" autoComplete="off" placeholder="Acme Resale" />
          </Field>
          <Field label="First Admin — email" required>
            <Input name="adminEmail" type="email" autoComplete="off" icon="at-sign" placeholder="name@example.com" />
          </Field>
          {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
        </SheetBody>
        <SheetFooter>
          <Button full type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create Store"}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
