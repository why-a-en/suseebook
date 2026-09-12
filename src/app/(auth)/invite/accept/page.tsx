import { currentSessionEmail, getInvitationForAccept, roleLabel } from "@/lib/auth";
import { Logo } from "@/components/ui/logo";
import { AcceptView } from "./accept-view";

// Reached from the link in sendInvitationEmail — `?token=` is the
// invitation id itself (docs/adr/0006-transactional-email.md §2). No
// requireUser() gate: a brand-new invitee has no session at all yet, which
// is exactly the case this screen exists to handle.
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invitation = token ? await getInvitationForAccept(token) : null;
  const signedInEmail = await currentSessionEmail();

  return (
    <main className="ds-grain-surface flex min-h-full flex-1 items-center justify-center bg-surface-page p-4">
      <div className="w-full max-w-[360px] space-y-6">
        <div className="space-y-1">
          <Logo size={32} wordmark />
        </div>
        {invitation && invitation.valid ? (
          <AcceptView
            token={invitation.id}
            email={invitation.email}
            organizationName={invitation.organizationName}
            roleLabel={roleLabel(invitation.role)}
            hasAccount={invitation.hasAccount}
            signedInEmail={signedInEmail}
          />
        ) : (
          <div className="space-y-2">
            <p className="font-ui text-body-strong text-text-strong">This invitation isn&rsquo;t valid.</p>
            <p className="font-ui text-small text-text-muted">
              It may have already been used, been cancelled, or expired. Ask whoever invited you
              to send a new one.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
