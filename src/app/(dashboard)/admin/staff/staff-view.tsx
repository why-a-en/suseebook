"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Screen, ScrollBody } from "@/components/ui/screen";
import { TopBar } from "@/components/ui/top-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { Row } from "@/components/ui/row";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { Icon } from "@/components/icon";
import type { PendingInvitation } from "@/lib/auth";
import type { StaffMember } from "@/services/staff";
import type { AppRole } from "@/services/types";
import {
  addStaffAction,
  cancelInviteAction,
  changeStaffRoleAction,
  removeStaffAction,
  resendInviteAction,
  resetStaffPasswordAction,
  setStaffStatusAction,
} from "./actions";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "support_agent", label: "Support" },
  { value: "supplier", label: "Supplier" },
  { value: "admin", label: "Admin" },
];

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  support_agent: "Support Agent",
  supplier: "Supplier",
};

export function StaffView({
  staff,
  currentUserId,
  pendingInvitations,
}: {
  staff: StaffMember[];
  currentUserId: string;
  pendingInvitations: PendingInvitation[];
}) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [selectedInvite, setSelectedInvite] = useState<PendingInvitation | null>(null);

  return (
    <Screen>
      {/* Reached from Home, not a tab — so it leads with a back arrow.
          See CLAUDE.md's "every nested screen has a back button". */}
      <TopBar backHref="/home" title="Staff" />
      <ScrollBody>
        <SectionHeader right={`${staff.length}`}>Team</SectionHeader>

        {staff.map((member) => {
          const isSelf = member.userId === currentUserId;
          return (
            <Row key={member.memberId} onClick={isSelf ? undefined : () => setSelected(member)}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {member.name}
                  {isSelf && <span className="text-text-faint"> (you)</span>}
                </span>
                <span className="truncate font-ui text-small text-text-faint">
                  {member.email}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {member.status === "suspended" && (
                  <span className="font-ui text-small text-danger">Suspended</span>
                )}
                <span className="font-ui text-small text-text-faint">
                  {ROLE_LABELS[member.role]}
                </span>
                {!isSelf && <Icon name="chevron-right" size={16} className="text-text-faint" />}
              </div>
            </Row>
          );
        })}

        {/* Hidden entirely once nobody's waiting — an empty "Pending"
            section would just be noise below a Team list that already
            says who's actually here. */}
        {pendingInvitations.length > 0 && (
          <>
            <SectionHeader right={`${pendingInvitations.length}`}>Pending</SectionHeader>
            {pendingInvitations.map((invite) => (
              <Row key={invite.id} onClick={() => setSelectedInvite(invite)}>
                <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-ui text-small text-text-faint">{ROLE_LABELS[invite.role]}</span>
                  <Icon name="chevron-right" size={16} className="text-text-faint" />
                </div>
              </Row>
            ))}
          </>
        )}

        <div className="px-5 pt-5 pb-8">
          <Button full variant="secondary" icon="user-plus" onClick={() => setAdding(true)}>
            Add staff
          </Button>
        </div>
      </ScrollBody>

      <AddStaffSheet open={adding} onOpenChange={setAdding} />
      <ManageStaffSheet member={selected} onClose={() => setSelected(null)} />
      <ManageInviteSheet invite={selectedInvite} onClose={() => setSelectedInvite(null)} />
    </Screen>
  );
}

function AddStaffSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The form only exists while the sheet is open, so useActionState is
          fresh on every open — otherwise the previous submit's confirmation
          would still be on screen the next time it opened. */}
      <SheetContent>{open && <AddStaffForm onDone={() => onOpenChange(false)} />}</SheetContent>
    </Sheet>
  );
}

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState<AppRole>("support_agent");
  const [state, formAction, pending] = useActionState(addStaffAction, undefined);

  // On success the sheet stays open on a confirmation — an invitation link
  // has been emailed; nothing about this person exists yet beyond that.
  if (state?.invitedEmail) {
    return (
      <>
        <SheetHeader title="Invitation sent" />
        <SheetBody>
          <InviteSent email={state.invitedEmail} />
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
      <SheetHeader title="Add staff" />
      <form action={formAction}>
        <SheetBody className="grid gap-4">
          <Field label="Email" required>
            <Input name="email" type="email" autoComplete="off" icon="at-sign" placeholder="name@example.com" />
          </Field>
          <Field label="Role" required>
            <SegmentedControl options={ROLE_OPTIONS} value={role} onChange={setRole} />
            <input type="hidden" name="role" value={role} />
          </Field>
          {state?.error && <p className="font-ui text-small text-danger">{state.error}</p>}
        </SheetBody>
        <SheetFooter>
          <Button full type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send invitation"}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}

/** New-member path: an invitation link, not a password — they set their own
 *  on accept (docs/adr/0006-transactional-email.md). */
function InviteSent({ email }: { email: string }) {
  return (
    <div className="grid gap-3">
      <p className="font-ui text-small text-text-body">
        We&apos;ve sent an invitation to <span className="font-medium">{email}</span>. They&apos;ll
        set their own name and password when they accept it.
      </p>
    </div>
  );
}

/** Reset-password path: a generated temporary password, emailed —
 *  the one credential this app still issues (docs/adr/0006). */
function InvitationSent({ email }: { email: string }) {
  return (
    <div className="grid gap-3">
      <p className="font-ui text-small text-text-body">
        We&apos;ve emailed sign-in details to <span className="font-medium">{email}</span>.
        They must choose a new password the first time they sign in.
      </p>
    </div>
  );
}

function ManageStaffSheet({
  member,
  onClose,
}: {
  member: StaffMember | null;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  function close() {
    setResetSentTo(null);
    onClose();
  }

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        // Service rules — "last active Admin", "can't remove yourself" —
        // surface as toasts rather than silently doing nothing.
        toast.error(result.error);
        return;
      }
      onClose();
    });
  }

  if (resetSentTo) {
    return (
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent>
          <SheetHeader title="New password sent" />
          <SheetBody>
            <InvitationSent email={resetSentTo} />
          </SheetBody>
          <SheetFooter>
            <Button full onClick={close}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={member !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent>
        {member && (
          <>
            <SheetHeader title={member.name} />
            <SheetBody className="grid gap-5">
              <Field label="Role">
                <SegmentedControl
                  options={ROLE_OPTIONS}
                  value={member.role}
                  onChange={(role) =>
                    run(() => changeStaffRoleAction(member.memberId, role))
                  }
                />
              </Field>

              <div className="grid gap-3">
                {/* The recovery path, in place of self-service "forgot
                    password" — see
                    docs/adr/0003-password-recovery-and-forced-change.md */}
                <Button
                  full
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await resetStaffPasswordAction(member.memberId);
                      if (result.error) {
                        toast.error(result.error);
                        return;
                      }
                      setResetSentTo(result.emailedTo!);
                    })
                  }
                >
                  Reset password
                </Button>

                <Button
                  full
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setStaffStatusAction(
                        member.memberId,
                        member.status === "suspended" ? "active" : "suspended",
                      ),
                    )
                  }
                >
                  {member.status === "suspended" ? "Restore access" : "Suspend access"}
                </Button>

                {/* Removal drops the membership; their Orders and Products
                    stay attributed to them. Suspending is the reversible
                    option, so it comes first. */}
                <Button
                  full
                  variant="danger"
                  disabled={pending}
                  onClick={() => run(() => removeStaffAction(member.memberId))}
                >
                  Remove from Organization
                </Button>
              </div>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ManageInviteSheet({
  invite,
  onClose,
}: {
  invite: PendingInvitation | null;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function resend() {
    if (!invite) return;
    startTransition(async () => {
      const result = await resendInviteAction(invite.email, invite.role);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Invitation resent to ${invite.email}.`);
      onClose();
    });
  }

  function cancel() {
    if (!invite) return;
    startTransition(async () => {
      const result = await cancelInviteAction(invite.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Sheet open={invite !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {invite && (
          <>
            <SheetHeader title={invite.email} eyebrow={`Invited as ${ROLE_LABELS[invite.role]}`} />
            <SheetBody className="grid gap-5">
              <p className="font-ui text-small text-text-faint">
                Expires{" "}
                {invite.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.
                Not yet accepted — nothing about this person exists beyond this invitation.
              </p>
              <div className="grid gap-3">
                <Button full variant="secondary" disabled={pending} onClick={resend}>
                  Resend
                </Button>
                <Button full variant="danger" disabled={pending} onClick={cancel}>
                  Cancel invitation
                </Button>
              </div>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
