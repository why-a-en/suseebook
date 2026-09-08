import type { ReactNode } from "react";

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Icon, type IconName } from "@/components/icon";
import { cn } from "@/lib/utils";

/** "Nothing here" for a list or a screen.
 *
 *  Composed on the registry's Empty parts rather than a hand-rolled stack of
 *  divs, so the structure (media / title / description / action) is the
 *  standard one — and restyled onto this system's display cut and mono
 *  micro-caps, since Empty ships with the default palette's `bg-muted` and
 *  `text-muted-foreground`.
 *
 *  The prop shape stays flat (`icon`/`title`/`body`/`action`) because every
 *  one of the eight call sites wants exactly this arrangement; there's no
 *  case yet for composing the parts by hand. */
export function EmptyState({
  icon = "inbox",
  title,
  body,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("gap-0 px-6 py-12", className)}>
      <EmptyHeader className="gap-0">
        <EmptyMedia className="mb-2.5 size-12 rounded-full bg-surface-raised text-text-faint">
          <Icon name={icon} size={20} />
        </EmptyMedia>
        <EmptyTitle className="font-display text-display-sm tracking-display text-text-strong">{title}</EmptyTitle>
        {body ? (
          // `overflow-wrap:anywhere` (not just `break-word`): several call
          // sites drop a user-typed search term into the body, and a long
          // unbroken one would otherwise blow past max-width and force the
          // scroll region wider than the screen.
          <EmptyDescription className="max-w-[260px] [overflow-wrap:anywhere] font-ui text-small text-text-muted">
            {body}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent className="mt-1.5">{action}</EmptyContent> : null}
    </Empty>
  );
}
