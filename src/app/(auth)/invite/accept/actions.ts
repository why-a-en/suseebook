"use server";

import { redirect } from "next/navigation";
import { acceptInvitationAsCurrentUser, acceptInvitationAsNewUser } from "@/lib/auth";

export type AcceptState = { error?: string } | undefined;

/**
 * The invitee has no account yet. signUpEmail (inside
 * acceptInvitationAsNewUser) fails outright if the email turns out to
 * already be registered — the page only offers this form when
 * `!invitation.hasAccount`, so that's a stale-page race, not the common
 * case, and surfaces as this function's ordinary error message.
 */
export async function acceptAsNewUserAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!token) return { error: "Missing invitation." };
  if (!name) return { error: "Name is required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  try {
    await acceptInvitationAsNewUser(token, { name, password });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't accept the invitation." };
  }
  redirect("/");
}

/** The invitee is already signed in as the invited address — the page only
 *  offers this when the two match, so no name/password to collect. */
export async function acceptAsCurrentUserAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "Missing invitation." };

  try {
    await acceptInvitationAsCurrentUser(token);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't accept the invitation." };
  }
  redirect("/");
}
