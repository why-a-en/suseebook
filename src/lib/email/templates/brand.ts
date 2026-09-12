// Hex mirror of the light-theme slice of src/styles/tokens/colors.css.
//
// Email clients can't consume the app's oklch tokens (Outlook's Word engine
// doesn't parse oklch at all, and several mobile clients strip unsupported
// colour functions rather than falling back), so this file hand-converts the
// handful of tokens an email actually needs to plain hex. Email always
// renders in the light palette — there's no in-client theme toggle to key
// off, and declaring `color-scheme: light` in <Head> (see layout.tsx) stops
// Gmail/Apple Mail's automatic dark-mode inversion from repainting these
// colours on top of that decision.
//
// Keep this in sync with colors.css's `[data-theme="light"]` block by eye;
// there's no build step that derives one from the other.
export const brand = {
  page: "#f2f1ee", // --surface-page
  card: "#ffffff", // --surface-card
  sunken: "#eeedea", // --surface-sunken — the credentials box fill
  hairline: "#e4e4e1", // --line-hairline
  line: "#d5d4d1", // --line-strong

  ink: "#1b1916", // --text-strong / --accent — headline text, button fill
  body: "#494844", // --text-body
  muted: "#565552", // --text-muted
  faint: "#63625e", // --text-faint — kicker labels, fine print

  inkInvert: "#f9f9f7", // --text-invert / --accent-ink — button label
} as const;

// System stacks, matching what the app itself uses (no @font-face — a
// webfont is one more thing for a mail client to refuse to load).
export const FONT_SANS =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif';
export const FONT_MONO =
  'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
