"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, roleLabel } from "@/lib/auth";
import { assertDeliverableEmail, normalizeEmail } from "@/lib/email/address";
import { sendCredentialsEmail } from "@/lib/email/send";
import { withCurrentOrganization } from "@/lib/tenancy";
import {
  addStaff,
  changeStaffRole,
  removeStaff,
  resetStaffPassword,
  setStaffStatus,
} from "@/services/staff";
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

const SEND_FAILED =
  "The account was created, but the invitation email failed to send. " +
  "Use Reset password to try again.";

export async function addStaffAction(
  _prev: IssuedPasswordResult | undefined,
  formData: FormData,
): Promise<IssuedPasswordResult> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  // Deliverability first — before the service creates a user for an address
  // that would only bounce. ServiceError here is a message for the Admin.
  try {
    await assertDeliverableEmail(email);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  const { value, error } = await asAdmin((ctx) =>
    addStaff(ctx, {
      name,
      email,
      role: String(formData.get("role") ?? "support_agent") as AppRole,
      storeIds: formData.getAll("storeIds").map(String),
    }),
  );
  if (error) return { error };

  try {
    await sendCredentialsEmail({
      to: value!.email,
      name: value!.name,
      temporaryPassword: value!.temporaryPassword,
      context: {
        kind: "new-staff",
        organizationName: value!.organizationName,
        roleLabel: roleLabel(value!.role),
      },
    });
  } catch {
    return { error: SEND_FAILED };
  }

  return { emailedTo: value!.email };
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
      context: { kind: "reset", organizationName: value!.organizationName },
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
