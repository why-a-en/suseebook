"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icon";
import { useFieldControlId, useFieldRequired } from "@/components/ui/field";
import { fieldShellSelf } from "@/components/ui/field-shell";

/** Multi-line input. Shares Input's exact border/focus/disabled treatment
 *  (field-shell.ts) — it used to declare its own, one step out of sync.
 *
 *  `resize-y` is deliberate on a phone-first app: the drag handle is a
 *  desktop affordance, and `field-sizing-content` grows the box to fit what
 *  has actually been typed on browsers that support it, so the handle is a
 *  fallback rather than the mechanism.
 *
 *  The leading `icon` is the same affordance Input carries, positioned
 *  rather than laid out: Input's icon centres in a fixed 44px row, but a
 *  textarea grows, and an icon centred in a four-line box floats beside
 *  nothing. This one is pinned to the first line, where the text starts, and
 *  stays there as the box grows. It's also `pointer-events-none` so the
 *  whole surface — glyph included — still puts the caret in the text. */
function Textarea({
  className,
  rows = 3,
  invalid,
  icon,
  id,
  required,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean; icon?: IconName }) {
  const controlId = useFieldControlId(id);
  const isRequired = useFieldRequired(required);

  const field = (
    <textarea
      id={controlId}
      data-slot="textarea"
      rows={rows}
      required={isRequired}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldShellSelf,
        "field-sizing-content resize-y rounded-sm py-2.5",
        // Clears the glyph by the same 16px + 12px gutter Input's addon
        // reserves, so the first character lands on the same x as a
        // single-line field's does.
        icon ? "pr-3 pl-9" : "px-3",
        className,
      )}
      {...props}
      // `field-sizing: content` sizes an empty box to its placeholder, which
      // collapses it below `rows` and makes a multi-line field read as a
      // cramped single-line input. Hold the floor at `rows` lines (+ the
      // py-2.5 and border) so it always looks like the textarea it is, then
      // let content grow it from there.
      style={{ minHeight: `calc(${rows} * 1lh + 1.25rem + 2px)`, ...props.style }}
    />
  );

  if (!icon) return field;

  return (
    <div className="relative grid">
      {/* Centres the 16px glyph on the first line: 10px of py-2.5 padding
          + half of the 22.5px line box (15px/1.5), less half the glyph —
          21.25 − 8 ≈ 13. That lands within a pixel of where Input centres
          its own icon in a 44px row, so the two read as the same field. */}
      <span aria-hidden="true" className="pointer-events-none absolute top-[13px] left-3 text-text-faint">
        <Icon name={icon} size={16} />
      </span>
      {field}
    </div>
  );
}

export { Textarea };
