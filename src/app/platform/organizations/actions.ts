"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformUser } from "@/lib/auth";
import { assertDeliverableEmail, normalizeEmail } from "@/lib/email/address";
import { sendCredentialsEmail } from "@/lib/email/send";
import { createOrganization, setOrganizationStatus } from "@/services/platform";
import { ServiceError } from "@/services/types";

// Thin wrappers — rules live in src/services/platform.ts. requirePlatformUser()
// on every action, not just the page: hiding a link is not access control.

export type PlatformActionResult = { error?: string };

/** On success, the address the new Admin's credentials were emailed to. */
export type NewOrgResult = PlatformActionResult & {
  slug?: string;
  emailedTo?: string;
};

export async function createOrganizationAction(
  _prev: NewOrgResult | undefined,
  formData: FormData,
): Promise<NewOrgResult> {
  await requirePlatformUser();

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const adminName = String(formData.get("adminName") ?? "").trim();
  const adminEmail = normalizeEmail(String(formData.get("adminEmail") ?? ""));

  let created: Awaited<ReturnType<typeof createOrganization>>;
  try {
    // Before we create anything: is this address even deliverable? A bad one
    // here is a hard bounce Resend holds against the whole sending domain.
    await assertDeliverableEmail(adminEmail);
    created = await createOrganization({ organizationName, adminName, adminEmail });
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath("/platform/organizations");

  // The credential exists only in memory, right here. If Resend won't take
  // it, it's gone — the Organization is created but its Admin can't get in
  // until someone resets the password. Say exactly that.
  try {
    await sendCredentialsEmail({
      to: created.adminEmail,
      name: adminName,
      temporaryPassword: created.temporaryPassword,
      context: { kind: "new-admin", organizationName },
    });
  } catch {
    return {
      error:
        "The Organization was created, but its Admin invitation email failed to send. " +
        "Open the Organization and reset the Admin's password to try again.",
    };
  }

  return { slug: created.slug, emailedTo: created.adminEmail };
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
