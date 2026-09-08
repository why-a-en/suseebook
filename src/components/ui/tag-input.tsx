"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icon";
import { useFieldControlId, useFieldRequired } from "@/components/ui/field";
import { fieldShellInner, fieldShellWrapper } from "@/components/ui/field-shell";

/** Multi-value entry as removable chips — for a set of short strings that a
 *  comma-string `<Input>` handled badly: Modifier Options, mainly. Each
 *  committed value is a pill you tap to drop; Enter or comma commits the one
 *  you're typing; Backspace on an empty box removes the last; and a pasted
 *  "a, b, c" lands as three.
 *
 *  Runs controlled (`value` + `onChange`, a string[]) for a client form, or
 *  — given just `name` — on its own inside a server `<form action>`, where it
 *  writes the comma-joined string to a hidden input that every existing
 *  modifier action already parses. The chips match the removable-option
 *  chips on the product page and echo the OptionChips pills the team will
 *  pick from later, so building a modifier looks like using one. */
export function TagInput({
  value,
  onChange,
  name,
  placeholder,
  icon,
  id,
  disabled,
  invalid,
  className,
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
  name?: string;
  placeholder?: string;
  icon?: IconName;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const controlId = useFieldControlId(id);
  const required = useFieldRequired();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uncontrolled, setUncontrolled] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const tags = value ?? uncontrolled;

  function setTags(next: string[]) {
    if (onChange) onChange(next);
    else setUncontrolled(next);
  }

  function addValues(raw: string) {
    const incoming = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (incoming.length === 0) return;
    const seen = new Set(tags.map((t) => t.toLowerCase()));
    const merged = [...tags];
    for (const v of incoming) {
      if (seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      merged.push(v);
    }
    if (merged.length !== tags.length) setTags(merged);
  }

  function commitDraft() {
    if (draft.trim()) addValues(draft);
    setDraft("");
  }

  function removeAt(i: number) {
    setTags(tags.filter((_, idx) => idx !== i));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      removeAt(tags.length - 1);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (text.includes(",")) {
      e.preventDefault();
      addValues(draft + text);
      setDraft("");
    }
  }

  return (
    <div
      className={cn(
        // Same shell as Input — border, sunken fill, focus-on-wrapper, the
        // --control-h-md floor and rounded-sm corners — so an empty TagInput
        // is indistinguishable from an empty <Input>. It only grows, and
        // wraps, once chips are in it.
        fieldShellWrapper,
        "h-auto min-h-(--control-h-md) flex-wrap content-center gap-1.5 rounded-sm px-3 py-1.5",
        disabled && "opacity-55",
        className,
      )}
      onMouseDown={(e) => {
        // Keep a click anywhere in the empty space landing on the input,
        // without stealing the mousedown from a chip's own button.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {icon ? (
        // In-flow, not absolutely pinned: `self-center` centres it on the
        // first flex line, so it's vertically centred whether the field is
        // one row (matching Input) or several (staying by the first chips
        // rather than floating to the middle of the box).
        <span aria-hidden="true" className="pointer-events-none shrink-0 self-center pr-0.5 text-text-faint">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      {tags.map((tag, i) => (
        <button
          key={`${tag}-${i}`}
          type="button"
          disabled={disabled}
          onClick={() => removeAt(i)}
          aria-label={`Remove ${tag}`}
          className="inline-flex items-center gap-1 rounded-full bg-surface-raised py-1 pr-2 pl-2.5 font-ui text-small text-text-strong transition-transform duration-instant ease-standard active:scale-90"
        >
          {tag}
          <Icon name="x" size={12} className="text-text-faint" />
        </button>
      ))}
      <input
        ref={inputRef}
        id={controlId}
        type="text"
        disabled={disabled}
        required={required && tags.length === 0 ? true : undefined}
        aria-invalid={invalid || undefined}
        value={draft}
        placeholder={tags.length === 0 ? placeholder : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={commitDraft}
        // The exact bare-control treatment Input's inner <input> uses —
        // `shadow-none` is the important part: it kills the global
        // :focus-visible ring (base.css) that was drawing a second white
        // outline inside the wrapper on focus. The wrapper owns focus, as
        // its border reaching --line-focus, same as every other field.
        className={cn(fieldShellInner, "h-7 min-w-[8ch] text-text-strong")}
      />
      {name ? <input type="hidden" name={name} value={tags.join(",")} /> : null}
    </div>
  );
}
