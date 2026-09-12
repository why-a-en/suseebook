"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformUser, roleLabel } from "@/lib/auth";
import { assertDeliverableEmail, normalizeEmail } from "@/lib/email/address";
import { sendInvitationEmail } from "@/lib/email/send";
import { createOrganization, setOrganizationStatus } from "@/services/platform";
import { ServiceError } from "@/services/types";

// Thin wrappers — rules live in src/services/platform.ts. requirePlatformUser()
// on every action, not just the page: hiding a link is not access control.

export type PlatformActionResult = { error?: string };

/** On success, the address the new Admin's invitation was emailed to. */
export type NewOrgResult = PlatformActionResult & {
  slug?: string;
  invitedEmail?: string;
};

export async function createOrganizationAction(
  _prev: NewOrgResult | undefined,
  formData: FormData,
): Promise<NewOrgResult> {
  const platformUser = await requirePlatformUser();

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const adminEmail = normalizeEmail(String(formData.get("adminEmail") ?? ""));

  let created: Awaited<ReturnType<typeof createOrganization>>;
  try {
    // Before we create anything: is this address even deliverable? A bad one
    // here is a hard bounce Resend holds against the whole sending domain.
    await assertDeliverableEmail(adminEmail);
    created = await createOrganization({
      organizationName,
      adminEmail,
      invitedById: platformUser.id,
    });
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath("/platform/organizations");

  // The invitations row already exists — created is the record, not a
  // credential that vanishes if this send fails. If Resend won't take it,
  // say so; a resend from here is future work (Task 6's other half), so for
  // now the operator's recourse is Support reaching out directly.
  try {
    await sendInvitationEmail({
      to: created.adminEmail,
      storeName: organizationName,
      roleLabel: roleLabel("admin"),
      token: created.invitationId,
      inviterName: platformUser.name,
    });
  } catch {
    return {
      error:
        "The Organization was created and the invitation recorded, but the email failed to send.",
    };
  }

  return { slug: created.slug, invitedEmail: created.adminEmail };
}

export async function setOrganizationStatusAction(
  organizationId: string,
  status: "active" | "suspended",
): Promise<PlatformActionResult> {
  await requirePlatformUser();
  try {
    await setOrganizationStatus({ organizationId, status });
    revalidatePath("/platform/organizations");
    // A suspended Organization must stop resolving to a session for its
    // members — bust the whole tenant layout cache.
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}
