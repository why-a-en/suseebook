"use client";

import * as React from "react";

import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { fieldShellWrapper, fieldShellInner } from "@/components/ui/field-shell";

/** The filter input at the top of a list screen — a leading search glyph and
 *  a trailing clear button, which is the registry InputGroup's exact shape.
 *
 *  It is the same control as Input, not a cousin: same shell, same radius,
 *  same 44px height, same prop surface (`ComponentProps<"input">`, so
 *  `disabled`, `autoFocus`, `name`, `onKeyDown` and a ref all work). It used
 *  to differ in three ways that had no reason behind them beyond nobody
 *  having reconciled them:
 *
 *  - it was `rounded-full` while every other field on every other screen was
 *    `rounded-sm`, so tabbing from a form to a filter changed the shape of
 *    the field under you;
 *  - it accepted five hand-picked props, so anything a caller needed beyond
 *    those (disabling it while a list loads, focusing it on mount) meant
 *    editing this file;
 *  - the clear button was a bare `<button>` carrying its own hover, focus
 *    ring and press — CLAUDE.md says reach for the kit, and the kit's
 *    IconButton already has all three. It was also a 16px tap target on a
 *    phone-first app; as an `icon-sm` IconButton it is 36px.
 *
 *  `trailing` is for the date filter that sits beside search on the Orders
 *  log and the purchase queue. Both screens previously hand-assembled that
 *  row — `flex items-center gap-2` outside, `min-w-0 flex-1` on the field —
 *  and the second one's comment ("Same one-row pairing as the Orders log,
 *  for the same reason") is what a duplicated layout looks like when it is
 *  noticed but not fixed. Passing the control in keeps the two identical by
 *  construction. */
function SearchField({
  value,
  onClear,
  placeholder = "Search",
  trailing,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "type"> & {
  value: string;
  onClear?: () => void;
  trailing?: React.ReactNode;
}) {
  const field = (
    <InputGroup
      data-slot="search-field"
      className={cn(fieldShellWrapper, "h-(--control-h-md) rounded-sm shadow-none", trailing && "min-w-0 flex-1", className)}
    >
      <InputGroupAddon align="inline-start" className="pl-3 text-text-faint">
        <Icon name="search" size={16} />
      </InputGroupAddon>

      <InputGroupInput
        // type="search" gets the right virtual keyboard (a Search key
        // instead of Enter) on the phones this is designed for.
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          fieldShellInner,
          "pl-0",
          // Safari draws its own clear affordance for type="search"; this
          // field has its own, and two would sit on top of each other.
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />

      {value && onClear ? (
        // `mr-0!` cancels the registry addon's `has-[>button]:mr-[-0.45rem]`
        // optical nudge. With a real button in here that negative margin
        // pushes the addon's border box ~7px past the group's right edge —
        // invisible on a wide screen, but on a phone it's enough to make the
        // whole field overflow its row once the clear button appears.
        <InputGroupAddon align="inline-end" className="mr-0! pr-1">
          <IconButton icon="x" label="Clear search" size="icon-sm" onClick={onClear} disabled={props.disabled} />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );

  if (!trailing) return field;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {field}
      {trailing}
    </div>
  );
}

export { SearchField };
