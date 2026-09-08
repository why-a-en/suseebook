import type { Metadata } from "next";
import { Public_Sans, Martian_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

// The design system's two faces (see src/styles/tokens/typography.css):
// Public Sans for display/UI/metric text, Martian Mono for micro-labels and
// codes. Loaded via next/font rather than the source project's Google Fonts
// CSS @import for self-hosting + no render-blocking network request.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: "variable",
});

const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SuSeeOS",
  description: "Product catalog and daily order coordination for Support Agents and Suppliers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${martianMono.variable} h-full antialiased`}
    >
      <head>
        {/* Dark is the token system's default (no attribute needed); this only
            has work to do when the viewer previously chose light — applied
            before paint so there's no flash back to dark on load. See
            components/ui/theme-toggle.tsx, which owns writing the choice. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.setAttribute("data-theme","light");}catch(e){}',
          }}
        />
      </head>
      {/* h-full (a definite height, not just a minimum) matters here: every
          screen's scroll region (Screen/ScrollBody, see
          components/ui/screen.tsx) is built as a flex:1 + min-height:0
          chain that only clips and scrolls internally when every ancestor up
          to the viewport has an actual bounded height to divide up. `body`
          previously used min-h-full (min-height:100%, no upper bound), which
          let it grow past the viewport to fit content instead of handing
          overflow to ScrollBody's own overflow-y:auto — the designated
          scroll region silently stopped scrolling (nothing to clip against),
          and only the page itself could ever reach the rest, which several
          real devices' touch scrolling didn't reliably do either. */}
      <body className="h-full flex flex-col overflow-x-hidden">
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
