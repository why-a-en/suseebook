"use client";

/**
 * A one-slot navigation guard, shared across the layout/route boundary that
 * React context can't cross cleanly here: the tab bar lives in the dashboard
 * layout, the thing that needs guarding (the order wizard) is a route
 * *inside* it, so the wizard can't provide context to the bar.
 *
 * Exactly one screen is ever guarded at a time. While it's armed, any
 * `<Link>` that opts in — see CenterTabBar's `onNavigate` — hands its
 * destination here first; the wizard's own top-bar back and "leave" paths
 * do the same. The armed handler decides what to do (in practice: open a
 * "save as draft?" dialog and stash the destination).
 *
 * `beforeunload` (hard nav / refresh / tab close) is handled separately by
 * the guarded screen — it only gets the browser's native prompt.
 */

type LeaveHandler = (destination: string | null) => void;

let armed: LeaveHandler | null = null;

/** Called by the guarded screen while it has unsaved work. */
export function armNavigationGuard(handler: LeaveHandler): void {
  armed = handler;
}

/** Called on cleanup. Only clears if `handler` is still the armed one, so a
 *  late cleanup can't wipe a newer screen's guard. */
export function disarmNavigationGuard(handler: LeaveHandler): void {
  if (armed === handler) armed = null;
}

/**
 * Ask the guard whether this navigation may proceed. Returns `true` if it
 * was intercepted (the caller must cancel its own navigation); `false` if
 * nothing is armed and the caller should navigate as normal.
 */
export function requestNavigation(destination: string | null): boolean {
  if (!armed) return false;
  armed(destination);
  return true;
}
