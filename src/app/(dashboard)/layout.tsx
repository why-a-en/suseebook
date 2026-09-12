import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser, type AppRole } from "@/lib/auth";
import { CenterTabBar } from "@/components/ui/center-tab-bar";
import type { TabItem } from "@/components/ui/tab-bar";
import { Toaster } from "@/components/ui/sonner";
import { ImpersonationBanner } from "@/components/impersonation-banner";

// Role-based tab set (PRD §4): each role's shell only shows what's relevant
// to their job, and both roles now share the exact same shape — one
// highest-value direct tab, Settings, Home in the middle. Small phones (the
// real target per docs/TECH_STACK.md §6) can't comfortably fit 5 tap
// targets in one bar, so everything else (for supplier: History, Products,
// Customers — for support_agent: Parcels, Products, Customers) moved to
// shortcuts on Home instead.
// Keyed on AppRole, not string: a role without an entry here would have
// been an undefined lookup and a runtime crash on the destructure below.
const NAV_BY_ROLE: Record<AppRole, { left: TabItem; right: TabItem }> = {
  // Admin leads with Orders, same as Support Agent — the business record is
  // the thing they check most. Everything admin-specific hangs off Home.
  admin: {
    left: { href: "/orders", label: "Orders", icon: "receipt" },
    right: { href: "/settings", label: "Settings", icon: "settings" },
  },
  support_agent: {
    left: { href: "/orders", label: "Orders", icon: "receipt" },
    right: { href: "/settings", label: "Settings", icon: "settings" },
  },
  supplier: {
    left: { href: "/purchase-queue", label: "To Purchase", icon: "shopping-cart" },
    right: { href: "/settings", label: "Settings", icon: "settings" },
  },
};

// Session check happens here (a DB hit), not in proxy.ts — see
// src/proxy.ts and docs/TECH_STACK.md's architecture notes for why.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  // A password someone else chose has to be replaced before anything else
  // happens. /change-password sits in the (auth) group, outside this layout,
  // so this cannot redirect to itself.
  //
  // Skipped while impersonating: a platform admin acting as this user must
  // not be pushed into a screen that would set that user's password.
  if (user.mustChangePassword && !user.impersonatedBy) redirect("/change-password");

  const { left, right } = NAV_BY_ROLE[user.role];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-(--content-max) flex-1 flex-col">
      {/* Above the content, on every screen, for the whole session — a
          platform admin must never lose track of whose data they are in. */}
      {user.impersonatedBy && <ImpersonationBanner email={user.email} />}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <CenterTabBar left={[left]} right={[right]} homeHref="/home" />
      <Toaster />
    </div>
  );
}
