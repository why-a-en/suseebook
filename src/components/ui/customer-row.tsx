import type { MouseEventHandler, ReactNode } from "react";
import { Icon } from "@/components/icon";
import { Row } from "@/components/ui/row";

/** Initials avatar + name + contact line. The avatar is a circle because the
 *  subject is a person (the system reserves the squircle for non-people). */
export function CustomerRow({
  name,
  phone,
  address,
  href,
  onClick,
  right,
  className,
}: {
  name: string;
  phone?: string | null;
  address?: string | null;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  right?: ReactNode;
  className?: string;
}) {
  const initials = String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const interactive = Boolean(href || onClick);

  return (
    <Row href={href} onClick={onClick} className={className}>
      <span
        aria-hidden="true"
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-accent-wash font-mono text-label tracking-[0.04em] text-accent-text"
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-ui text-body-strong text-text-strong">{name}</span>
        <span className="block truncate font-ui text-small text-text-muted">{[phone, address].filter(Boolean).join(", ")}</span>
      </span>
      {right ?? (interactive ? <Icon name="chevron-right" size={16} color="var(--color-text-faint)" /> : null)}
    </Row>
  );
}
