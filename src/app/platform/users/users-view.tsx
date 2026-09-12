"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Screen, ScrollBody, Toolbar } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { Icon } from "@/components/icon";
import type { PlatformUserRow } from "@/services/platform";
import type { AppRole } from "@/services/types";
import { impersonateAction } from "../actions";

const ROLE_LABELS = {
  admin: "Admin",
  support_agent: "Support",
  supplier: "Supplier",
} as const;

type RoleFilter = "all" | AppRole;

const ROLE_SEGMENTS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admins" },
  { value: "support_agent", label: "Support" },
  { value: "supplier", label: "Suppliers" },
];

function membershipLine(user: PlatformUserRow): string {
  if (user.isOperator) return "Platform operator";
  if (user.memberships.length === 0) return "No organizations";
  return user.memberships.map((m) => `${m.orgName} · ${ROLE_LABELS[m.role]}`).join("   ");
}

export function UsersView({ users }: { users: PlatformUserRow[] }) {
  const [selected, setSelected] = useState<PlatformUserRow | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (q && !`${user.name} ${user.email}`.toLowerCase().includes(q)) return false;
      if (role !== "all" && !user.memberships.some((m) => m.role === role)) return false;
      return true;
    });
  }, [users, query, role]);

  const filtering = query.trim() !== "" || role !== "all";

  return (
    <Screen>
      <TopBar backHref="/platform" title="Users" eyebrow="Operator" />
      <Toolbar className="pb-2">
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search name or email"
        />
      </Toolbar>
      <Toolbar className="pt-0">
        <SegmentedControl options={ROLE_SEGMENTS} value={role} onChange={setRole} />
      </Toolbar>
      <ScrollBody>
        <SectionHeader right={filtering ? `${filtered.length} of ${users.length}` : `${users.length}`}>
          {filtering ? "Matching" : "Everyone"}
        </SectionHeader>

        {filtered.length === 0 ? (
          <EmptyState icon="search" title="No matching users." body="Try a different search or filter." />
        ) : (
          filtered.map((user) => (
            <Row key={user.id} onClick={() => setSelected(user)}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {user.name}
                  {user.isOperator && <span className="text-text-faint"> · operator</span>}
                </span>
                <span className="truncate font-ui text-small text-text-faint">{user.email}</span>
                <span className="truncate font-ui text-small text-text-faint">
                  {membershipLine(user)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {user.memberships.some((m) => m.memberStatus === "suspended") && (
                  <span className="font-ui text-small text-danger">Suspended</span>
                )}
                <Icon name="chevron-right" size={16} className="text-text-faint" />
              </div>
            </Row>
          ))
        )}
      </ScrollBody>

      <UserSheet user={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}

function UserSheet({
  user,
  onClose,
}: {
  user: PlatformUserRow | null;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const canImpersonate = user !== null && !user.isOperator && user.memberships.length > 0;

  return (
    <Sheet open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {user && (
          <>
            <SheetHeader title={user.name} />
            <SheetBody className="grid gap-4">
              <p className="font-ui text-small text-text-faint">{user.email}</p>

              <div className="grid gap-2">
                <span className="font-mono text-label tracking-label uppercase text-text-faint">
                  Memberships
                </span>
                {user.isOperator ? (
                  <p className="font-ui text-small text-text-body">
                    Platform operator — no tenant Store.
                  </p>
                ) : user.memberships.length === 0 ? (
                  <p className="font-ui text-small text-text-body">None.</p>
                ) : (
                  user.memberships.map((m) => (
                    <div
                      key={m.orgSlug}
                      className="flex items-center justify-between gap-2 rounded-md border border-line-hairline bg-surface-card px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-ui text-small-strong text-text-strong">
                          {m.orgName}
                        </div>
                        <div className="font-ui text-small text-text-faint">
                          {ROLE_LABELS[m.role]}
                          {m.memberStatus === "suspended" && " · suspended"}
                          {m.orgStatus === "suspended" && " · org suspended"}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SheetBody>
            <SheetFooter>
              <Button
                full
                variant="secondary"
                icon="user"
                disabled={!canImpersonate || pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await impersonateAction(user.email);
                    if (result?.error) toast.error(result.error);
                  })
                }
              >
                {canImpersonate ? "Impersonate" : "Can't impersonate"}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
