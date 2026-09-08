"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { requestNavigation } from "@/lib/navigation-guard";
import type { TabItem } from "@/components/ui/tab-bar";

const ISLAND_D = 56;
const ISLAND_RISE = ISLAND_D * 0.42; // how far above the bar's top edge the island floats
const CENTER_GUTTER = 36; // clearance between the two side tabs and the island between them

/** Bottom nav — same real-route Link navigation as TabBar (see its own doc
 *  comment). Two flat side segments meet edge-to-edge in the middle; Home
 *  floats above that seam as a solid accent circle, held up by elevation
 *  (position + shadow) alone. No SVG-cut notch under it, and no text label
 *  next to the icon — shape, fill and position already say "Home" once it's
 *  the one round, raised, floating thing in a row of flat tabs. */
export function CenterTabBar({ left, right, homeHref, className }: { left: TabItem[]; right: TabItem[]; homeHref: string; className?: string }) {
  const pathname = usePathname();
  const homeOn = pathname === homeHref || pathname.startsWith(homeHref + "/");

  function renderSide(items: TabItem[]) {
    return items.map((it) => {
      const on = pathname === it.href || pathname.startsWith(it.href + "/");
      return (
        <Link
          key={it.href}
          href={it.href}
          onNavigate={(e) => {
            if (requestNavigation(it.href)) e.preventDefault();
          }}
          className={cn("ds-nav-link relative flex flex-1 flex-col items-center justify-center gap-1", on ? "text-accent-text" : "text-text-faint")}
        >
          {on ? <span className="absolute inset-x-[28%] top-0 h-0.5 bg-accent" /> : null}
          <span className="relative flex">
            <Icon name={it.icon} size={20} strokeWidth={on ? 2.25 : 1.75} />
            {it.count ? (
              <span className="absolute -top-1.5 -right-2.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[8px] text-accent-ink">
                {it.count}
              </span>
            ) : null}
          </span>
          <span className="font-mono text-[9px] tracking-[0.06em] uppercase">{it.label}</span>
        </Link>
      );
    });
  }

  return (
    <div className={cn("relative", className)} style={{ height: "var(--bar-bottom-h)" }}>
      <nav className="sticky bottom-0 z-20 flex h-full items-stretch border-t border-line-hairline bg-surface-card">
        {renderSide(left)}
        {/* Fixed gutter, not part of either flex:1 side — gives the tabs some
            clearance from the island without needing to touch its centering
            (that's still purely left:50% on the full-width wrapper below). */}
        <div className="shrink-0" style={{ width: CENTER_GUTTER }} />
        {renderSide(right)}
      </nav>

      <Link
        href={homeHref}
        aria-label="Home"
        aria-current={homeOn ? "page" : undefined}
        title="Home"
        onNavigate={(e) => {
          if (requestNavigation(homeHref)) e.preventDefault();
        }}
        className="ds-nav-link absolute left-1/2 z-[21] flex items-center justify-center rounded-full bg-accent text-accent-ink shadow-raised transition-transform duration-fast ease-standard"
        style={{
          top: -ISLAND_RISE,
          width: ISLAND_D,
          height: ISLAND_D,
          transform: `translateX(-50%) scale(${homeOn ? 1.06 : 1})`,
        }}
      >
        <Icon name="home" size={homeOn ? 25 : 22} strokeWidth={homeOn ? 2.25 : 1.75} />
      </Link>
    </div>
  );
}
