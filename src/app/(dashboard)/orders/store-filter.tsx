"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";

import { Sheet, SheetContent, SheetHeader, SheetBody } from "@/components/ui/sheet";
import { Row } from "@/components/ui/row";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export type StoreOption = { id: string; name: string; status: "active" | "suspended" };

/**
 * The `?store=` filter on the Order log — a compact trigger beside the
 * Placed/Draft segments that opens a sheet listing every Store the member is
 * granted, plus "All stores".
 *
 * Mirrors DateRangeFilter beside it: collapsed to a single icon square until
 * a Store is chosen, then widened just enough to name it, so search keeps the
 * room it needs one row up. Only rendered for a member granted 2+ Stores
 * (see orders-view) — one Store is the whole log and needs no control.
 *
 * `shallow: false`: a server filter like date and status. The list fetches a
 * capped page, so narrowing by Store in the browser would only ever look
 * inside the newest rows — the round-trip is the point.
 */
export function StoreFilter({ stores }: { stores: StoreOption[] }) {
  const [store, setStore] = useQueryState("store", {
    defaultValue: "",
    shallow: false,
    clearOnDefault: true,
  });
  const [open, setOpen] = useState(false);

  const active = stores.find((s) => s.id === store) ?? null;

  function pick(id: string | null) {
    void setStore(id ?? "");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={active ? `Store filter: ${active.name}. Change` : "Filter by store"}
        className={cn(
          "flex h-(--control-h-md) shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm border bg-surface-sunken outline-none",
          "transition-[background,border-color,box-shadow,scale] duration-fast ease-standard",
          "hover:border-line-strong active:scale-95 focus-visible:shadow-[var(--focus-ring)]",
          active ? "max-w-[128px] border-line-strong px-2.5" : "w-(--control-h-md) border-line-hairline",
        )}
      >
        <Icon name="store" size={16} color={active ? "var(--color-text-strong)" : "var(--color-text-faint)"} />
        {active ? (
          <span className="min-w-0 truncate font-ui text-small-strong text-text-strong">{active.name}</span>
        ) : null}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader title="Filter by store" eyebrow="store" />
          <SheetBody>
            {/* Full-bleed rows — cancel the sheet body's gutter so the
                hairlines run edge to edge, the app's list rhythm. */}
            <div className="-mx-5">
              <Row onClick={active ? () => pick(null) : undefined}>
                <span className="min-w-0 flex-1 truncate">All stores</span>
                {!active && <Icon name="check" size={16} className="shrink-0 text-text-faint" />}
              </Row>
              {stores.map((s) => {
                const isActive = s.id === store;
                return (
                  <Row key={s.id} onClick={isActive ? undefined : () => pick(s.id)}>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{s.name}</span>
                      {s.status === "suspended" && (
                        <span className="font-ui text-small text-danger">Suspended</span>
                      )}
                    </div>
                    {isActive && <Icon name="check" size={16} className="shrink-0 text-text-faint" />}
                  </Row>
                );
              })}
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
