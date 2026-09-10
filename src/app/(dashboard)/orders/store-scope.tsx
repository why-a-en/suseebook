"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";

import { Sheet, SheetContent, SheetHeader, SheetBody } from "@/components/ui/sheet";
import { Row } from "@/components/ui/row";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export type StoreOption = { id: string; name: string; status: "active" | "suspended" };

/**
 * Which Store's log you're looking at — scope, not a filter, so it rides in
 * the TopBar under the title rather than in the filter row with date and
 * status. Reads "All stores" until you narrow to one; tapping opens a sheet
 * of every Store the member is granted.
 *
 * Only rendered for a member granted 2+ Stores (see orders-view) — with one
 * Store the log is already that Store and there's nothing to choose.
 *
 * The choice lives in `?store=` with `shallow: false`: it's a server filter
 * like date and status. The list fetches a capped page, so narrowing in the
 * browser would only ever look inside the newest rows — the round-trip is
 * the point.
 */
export function StoreScope({ stores }: { stores: StoreOption[] }) {
  const [store, setStore] = useQueryState("store", {
    defaultValue: "",
    shallow: false,
    clearOnDefault: true,
  });
  const [open, setOpen] = useState(false);

  const active = stores.find((s) => s.id === store) ?? null;
  const label = active ? active.name : "All stores";

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
        aria-label={`Store: ${label}. Change`}
        className={cn(
          "-mx-1 flex max-w-full items-center gap-1 rounded-xs px-1 py-0.5 outline-none",
          "text-text-faint transition-[color,scale] duration-fast ease-standard",
          "hover:text-text-strong active:scale-[0.98] focus-visible:shadow-[var(--focus-ring)]",
        )}
      >
        <Icon name="store" size={13} className="shrink-0" />
        <span className="min-w-0 truncate font-ui text-small-strong">{label}</span>
        <Icon name="chevron-down" size={13} className="shrink-0" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader title="Store" eyebrow="viewing" />
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
