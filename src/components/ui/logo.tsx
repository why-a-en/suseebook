import { cn } from "@/lib/utils";

/** The SuSeeOS mark: a rounded, engineered cart in motion with a dollar coin
 *  riding inside the basket — product moving, money counted. The coin sits in a
 *  cut-out so it separates on any surface; solid elsewhere so it holds at 16px.
 *  Monochrome — no hue at all. */
export function Logo({ size = 22, wordmark = false, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center text-text-strong", className)} style={{ gap: 0.44 * size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="block shrink-0">
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.42">
          <path d="M1.4 11.4h2.4" />
          <path d="M2.5 14.6h1.6" />
        </g>
        <path d="M1.9 3.3h1.7l1.1 3.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M8.4 6.2h9.2a3.6 3.6 0 0 1 3.6 3.6v3a3.6 3.6 0 0 1-3.6 3.6H8.4a3.6 3.6 0 0 1-3.6-3.6v-3a3.6 3.6 0 0 1 3.6-3.6Zm5 1.6a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
        />
        <circle cx="13.4" cy="11.3" r="2.55" fill="currentColor" />
        <circle cx="9.3" cy="19.9" r="1.8" fill="currentColor" />
        <circle cx="17.1" cy="19.9" r="1.8" fill="currentColor" />
      </svg>
      {wordmark ? (
        <span className="whitespace-nowrap font-display leading-none tracking-display" style={{ fontSize: size * 0.86 }}>
          SuSee<span className="text-text-strong">OS</span>
        </span>
      ) : null}
    </span>
  );
}
