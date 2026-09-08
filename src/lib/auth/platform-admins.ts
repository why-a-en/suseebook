// Who runs SuSeeOS. An allowlist of `users.id`s in the environment — the
// single source of truth for platform-operator status, so there is no
// in-app path to becoming one and a database compromise can't grant it.
//
// Framework-free on purpose: `src/services/` reads this too, and nothing
// under services may depend on the Next.js side of the app. `src/lib/auth`
// re-exports it for feature code.

/** Is this user id a platform operator? */
export function isPlatformAdmin(userId: string): boolean {
  return (process.env.PLATFORM_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}
