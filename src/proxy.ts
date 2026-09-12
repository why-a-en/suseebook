import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME } from "@/lib/auth/constants";

// Cheap cookie-presence check only — not a real session validation (that
// needs a DB hit, which happens in the (dashboard) layout server component
// instead). See docs/TECH_STACK.md's architecture notes: keeps this simple
// and keeps the DB hit in one place rather than duplicated here too. (Next
// 16 runs Proxy on the Node.js runtime by default, so a DB call would work
// here now — this split is for separation of concerns, not a runtime
// limitation.)
//
// Deliberately does NOT bounce an already-logged-in visitor away from
// /login — that used to live here, keyed on cookie presence, and it caused
// a real redirect loop: a *stale* cookie (present, but no longer matching
// a session — e.g. after a DB reset) is "logged in" by this cheap check
// but not by requireUser()'s real one, so the two sides disagreed and
// bounced the browser between / and /login forever. The login page does
// that bounce itself now, using the same real check requireUser() uses, so
// there's exactly one source of truth for "is this session actually
// valid" instead of two that can disagree.
export function proxy(request: NextRequest) {
  const hasSessionCookie =
    request.cookies.has(SESSION_COOKIE_NAME) ||
    request.cookies.has(SECURE_SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;
  // /invite/accept is the one route a visitor reaches with *no* session at
  // all — a brand-new invitee clicking the link in sendInvitationEmail
  // (docs/adr/0006-transactional-email.md). Gating it here the same way as
  // every other route would bounce them to /login before the page — the one
  // place that actually reads ?token= — ever renders, silently dropping it.
  const isPublicRoute = pathname.startsWith("/login") || pathname.startsWith("/invite/accept");

  if (!hasSessionCookie && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except static assets and Next internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
