"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { Icon } from "@/components/icon";
import type { OrganizationDetail } from "@/services/platform";
import { impersonateAction } from "../../actions";
import { setOrganizationStatusAction } from "../actions";

const ROLE_LABELS = {
  admin: "Admin",
  support_agent: "Support Agent",
  supplier: "Supplier",
} as const;

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type Member = OrganizationDetail["members"][number];

export function OrganizationDetailView({ org }: { org: OrganizationDetail }) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Member | null>(null);

  return (
    <Screen>
      <TopBar backHref="/platform/organizations" title={org.name} eyebrow="Operator" />
      <ScrollBody>
        <div className="grid gap-3 px-5 py-4">
          <p className="font-ui text-small text-text-faint">
            <code className="font-mono text-code">{org.slug}</code> · created{" "}
            {formatDate(org.createdAt)}
            {org.status === "suspended" && (
              <span className="text-danger"> · suspended</span>
            )}
          </p>

          {/* Suspension is the only lever over a client account (ADR-0002
              §8) — a suspended Organization resolves to no session for every
              one of its members on their next request. */}
          <Button
            full
            variant={org.status === "suspended" ? "secondary" : "danger"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setOrganizationStatusAction(
                  org.id,
                  org.status === "suspended" ? "active" : "suspended",
                );
                if (result.error) toast.error(result.error);
              })
            }
          >
            {org.status === "suspended" ? "Restore Store" : "Suspend Store"}
          </Button>
        </div>

        <SectionHeader right={`${org.members.length}`}>Members</SectionHeader>
        {org.members.map((member) => (
          <Row key={member.userId} onClick={() => setSelected(member)}>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{member.name}</span>
              <span className="truncate font-ui text-small text-text-faint">{member.email}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {member.status === "suspended" && (
                <span className="font-ui text-small text-danger">Suspended</span>
              )}
              <span className="font-ui text-small text-text-faint">
                {ROLE_LABELS[member.role]}
              </span>
              <Icon name="chevron-right" size={16} className="text-text-faint" />
            </div>
          </Row>
        ))}
      </ScrollBody>

      <MemberSheet
        member={selected}
        orgSuspended={org.status === "suspended"}
        onClose={() => setSelected(null)}
      />
    </Screen>
  );
}

function MemberSheet({
  member,
  orgSuspended,
  onClose,
}: {
  member: Member | null;
  orgSuspended: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Sheet open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {member && (
          <>
            <SheetHeader title={member.name} />
            <SheetBody className="grid gap-3">
              <p className="font-ui text-small text-text-faint">{member.email}</p>
              <p className="font-ui text-small text-text-body">
                {ROLE_LABELS[member.role]}
                {member.status === "suspended" && " · membership suspended"} · joined{" "}
                {formatDate(member.joinedAt)}
              </p>
            </SheetBody>
            <SheetFooter>
              {/* Can't impersonate into a suspended org — its members
                  resolve to no session, so the impersonated view would just
                  be the login screen. Restore it first. */}
              <Button
                full
                variant="secondary"
                icon="user"
                disabled={pending || orgSuspended}
                onClick={() =>
                  startTransition(async () => {
                    const result = await impersonateAction(member.email);
                    if (result?.error) toast.error(result.error);
                  })
                }
              >
                {orgSuspended ? "Can't impersonate — org suspended" : "Impersonate"}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
