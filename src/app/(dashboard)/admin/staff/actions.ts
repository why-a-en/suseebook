"use server";

import { revalidatePath } from "next/cache";
import { cancelOrganizationInvitation, inviteToOrganization, requireAdmin } from "@/lib/auth";
import { assertDeliverableEmail, normalizeEmail } from "@/lib/email/address";
import { sendCredentialsEmail } from "@/lib/email/send";
import { withCurrentOrganization } from "@/lib/tenancy";
import { changeStaffRole, removeStaff, resetStaffPassword, setStaffStatus } from "@/services/staff";
import { ServiceError, type AppRole } from "@/services/types";

// Thin wrappers. Every rule lives in src/services/staff.ts; what belongs
// here is exactly what a service cannot do — check the session, tell Next.js
// to re-render, and send the credential email (I/O we keep out of the
// service's transaction). See docs/ARCHITECTURE_ROADMAP.md §4.

export type StaffActionResult = { error?: string };

/** On success, the address the credential was emailed to. */
export type IssuedPasswordResult = StaffActionResult & { emailedTo?: string };

type Ctx = Parameters<Parameters<typeof withCurrentOrganization>[0]>[0];

/**
 * requireAdmin() on every action, not just on the page that renders the
 * link. Hiding a shortcut is not access control.
 */
async function asAdmin<T>(
  fn: (ctx: Ctx) => Promise<T>,
): Promise<{ value?: T; error?: string }> {
  await requireAdmin();
  try {
    const value = await withCurrentOrganization(fn);
    revalidatePath("/admin/staff");
    return { value };
  } catch (error) {
    // A rule the Admin broke, shown to them verbatim. Anything else is a
    // bug and should keep its stack rather than be flattened into a string.
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

/** On success, the address an invitation was sent to. No name to collect —
 *  the invitee sets their own on accept (docs/adr/0005-store-as-sole-tenant.md
 *  §5); nothing here creates an account. */
export type InvitationSentResult = StaffActionResult & { invitedEmail?: string };

/** Shared by a fresh "Add staff" submit and "Resend" on an existing pending
 *  row — both are exactly "invite this email to this role", the plugin's
 *  own resend:true (config.ts) is what makes the second one supersede the
 *  first rather than double up. */
async function sendInvite(email: string, role: AppRole): Promise<InvitationSentResult> {
  // Deliverability first — the plugin would otherwise write an invitations
  // row for an address that can only bounce. ServiceError here is a message
  // for the Admin.
  try {
    await assertDeliverableEmail(email);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  try {
    await inviteToOrganization({ email, role });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Couldn't send the invitation. Try again from Staff.",
    };
  }

  revalidatePath("/admin/staff");
  return { invitedEmail: email };
}

export async function addStaffAction(
  _prev: InvitationSentResult | undefined,
  formData: FormData,
): Promise<InvitationSentResult> {
  await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "support_agent") as AppRole;
  return sendInvite(email, role);
}

export async function resendInviteAction(email: string, role: AppRole): Promise<InvitationSentResult> {
  await requireAdmin();
  return sendInvite(normalizeEmail(email), role);
}

export async function cancelInviteAction(invitationId: string): Promise<StaffActionResult> {
  await requireAdmin();
  try {
    await cancelOrganizationInvitation(invitationId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't cancel the invitation." };
  }
  revalidatePath("/admin/staff");
  return {};
}

export async function resetStaffPasswordAction(
  memberId: string,
): Promise<IssuedPasswordResult> {
  const { value, error } = await asAdmin((ctx) => resetStaffPassword(ctx, memberId));
  if (error) return { error };

  try {
    await sendCredentialsEmail({
      to: value!.email,
      name: value!.name,
      temporaryPassword: value!.temporaryPassword,
      organizationName: value!.organizationName,
    });
  } catch {
    return {
      error:
        "The password was reset, but the email failed to send. Try Reset password again.",
    };
  }

  return { emailedTo: value!.email };
}

export async function changeStaffRoleAction(
  memberId: string,
  role: AppRole,
): Promise<StaffActionResult> {
  const { error } = await asAdmin((ctx) => changeStaffRole(ctx, { memberId, role }));
  return error ? { error } : {};
}

export async function setStaffStatusAction(
  memberId: string,
  status: "active" | "suspended",
): Promise<StaffActionResult> {
  const { error } = await asAdmin((ctx) => setStaffStatus(ctx, { memberId, status }));
  return error ? { error } : {};
}

export async function removeStaffAction(memberId: string): Promise<StaffActionResult> {
  const { error } = await asAdmin((ctx) => removeStaff(ctx, memberId));
  return error ? { error } : {};
}
