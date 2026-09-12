// The app's own public base URL, for links we put in outbound email.
//
// Same resolution order as better-auth's `resolveBaseURL` (src/lib/auth/config.ts),
// duplicated here rather than imported because that file is off-limits to
// feature code — and this needs no `next/*` either, so email helpers stay
// framework-free. `APP_BASE_URL` wins; on Vercel fall back to the stable
// production domain, then the per-deployment URL; localhost last.
export function appBaseURL(): string {
  const explicit = process.env.APP_BASE_URL ?? process.env.BETTER_AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}
