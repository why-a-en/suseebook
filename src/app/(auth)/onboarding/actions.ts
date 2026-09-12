"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { inviteToOrganization, requireAdmin } from "@/lib/auth";
import { assertDeliverableEmail, normalizeEmail } from "@/lib/email/address";
import { withCurrentOrganization } from "@/lib/tenancy";
import { createStore } from "@/services/stores";
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
  | { error?: string; invitedEmail?: string }
  | undefined;

export async function addFirstStaffAction(
  _prev: AddFirstStaffState,
  formData: FormData,
): Promise<AddFirstStaffState> {
  await requireAdmin();

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "support_agent") as AppRole;

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
        error instanceof Error ? error.message : "Couldn't send the invitation. You can retry from Staff.",
    };
  }

  revalidatePath("/", "layout");
  return { invitedEmail: email };
}

export async function finishOnboardingAction() {
  await requireAdmin();
  redirect("/home");
}
