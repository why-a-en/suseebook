import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/** Screen header. Titles are sans — screen-title weight when the title names a
 *  place, UI title when it names a record. Top-level screens lead with the mark;
 *  pushed records lead with a back button. The two are mutually exclusive.
 *
 *  No hooks/handlers of its own — onBack goes to IconButton, itself a client
 *  component — so TopBar stays usable directly from a Server Component, as
 *  long as the caller doesn't need a real onBack: a Server Component can't
 *  hand IconButton a closure (functions aren't serializable across that
 *  boundary), only a Client Component caller can. backHref is the
 *  Server-Component-safe equivalent — a plain string routes through Link,
 *  no function required — for a page that just needs "back to X". */
export function TopBar({
  title,
  eyebrow,
  subtitle,
  brand = false,
  onBack,
  backHref,
  right,
  className,
}: {
  title: string;
  eyebrow?: string;
  /** A line *below* the title — for a scope control the screen is bound to
   *  (the Orders log's Store picker), not a second filter. Interactive, so
   *  it comes from a Client Component caller. */
  subtitle?: ReactNode;
  brand?: boolean;
  onBack?: () => void;
  backHref?: string;
  right?: ReactNode;
  className?: string;
}) {
  const hasBack = Boolean(onBack) || Boolean(backHref);
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex items-center gap-3 border-b border-line-hairline bg-surface-page px-5 py-3.5",
        className,
      )}
      style={{ minHeight: "var(--bar-top-h)" }}
    >
      {onBack ? <IconButton icon="arrow-left" label="Back" onClick={onBack} size="icon-sm" className="-ml-2" /> : null}
      {!onBack && backHref ? <IconButton icon="arrow-left" label="Back" href={backHref} size="icon-sm" className="-ml-2" /> : null}
      {brand && !hasBack ? <Logo size={20} className="mr-0.5" /> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mb-1 font-mono text-label tracking-label uppercase text-text-faint">{eyebrow}</div> : null}
        <div className="truncate font-ui text-screen-title tracking-screen-title text-text-strong">{title}</div>
        {subtitle ? <div className="mt-1.5 min-w-0">{subtitle}</div> : null}
      </div>
      {right}
    </header>
  );
}
