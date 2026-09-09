"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, roleLabel } from "@/lib/auth";
import { assertDeliverableEmail, normalizeEmail } from "@/lib/email/address";
import { sendCredentialsEmail } from "@/lib/email/send";
import { withCurrentOrganization } from "@/lib/tenancy";
import { createStore } from "@/services/stores";
import { addStaff } from "@/services/staff";
import { ServiceError, type AppRole } from "@/services/types";

// First-run onboarding, Admin only (the (dashboard) layout only sends
// Admins here). Two steps, each a plain server round-trip — no client
// wizard state to lose:
//   1. create the first Store   → createStore also grants it to this Admin
//                                 (see its comment), so the layout gate and
//                                 the /select-store gate both clear
//   2. add the first teammate   → optional; "Skip" just goes to /home

export type OnboardingState = { error?: string } | undefined;

export async function createFirstStoreAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  await requireAdmin();
  try {
    await withCurrentOrganization((ctx) => createStore(ctx, { name: String(formData.get("name") ?? "") }));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
  // No redirect — the page re-reads and moves itself to step 2 now that a
  // Store exists. revalidate both this screen and the layout that gated us
  // here.
  revalidatePath("/onboarding");
  revalidatePath("/", "layout");
  return {};
}

export type AddFirstStaffState =
  | { error?: string; emailedTo?: string }
  | undefined;

export async function addFirstStaffAction(
  _prev: AddFirstStaffState,
  formData: FormData,
): Promise<AddFirstStaffState> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  let created: Awaited<ReturnType<typeof addStaff>>;
  try {
    await assertDeliverableEmail(email);
    created = await withCurrentOrganization((ctx) =>
      addStaff(ctx, {
        name,
        email,
        role: String(formData.get("role") ?? "support_agent") as AppRole,
        storeIds: formData.getAll("storeIds").map(String),
      }),
    );
    revalidatePath("/", "layout");
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  try {
    await sendCredentialsEmail({
      to: created.email,
      name: created.name,
      temporaryPassword: created.temporaryPassword,
      context: {
        kind: "new-staff",
        organizationName: created.organizationName,
        roleLabel: roleLabel(created.role),
      },
    });
  } catch {
    return {
      error:
        "The teammate was added, but the invitation email failed to send. " +
        "You can resend it from Staff with Reset password.",
    };
  }

  return { emailedTo: created.email };
}

export async function finishOnboardingAction() {
  await requireAdmin();
  redirect("/home");
}
