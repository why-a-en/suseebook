// The real app wordmark (public/logo/logo-lockup-light.svg — the "for light
// surfaces" variant), inlined as a data URI.
//
// Deliberately NOT fetched by URL (`<Img src="${appBaseURL()}/logo/...">`):
// proxy.ts's middleware matcher only excludes `_next/static`, `_next/image`
// and `favicon.ico` — every other path, public assets included, redirects an
// unauthenticated request to /login. The app itself never hits this because
// src/components/ui/logo.tsx draws the mark as inline JSX rather than
// fetching the SVG file, but a recipient's mail client fetching this email's
// images would get a login-page redirect instead of the logo. Inlining the
// bytes sidesteps that entirely — no request, so the middleware is moot.
//
// Generated once via `Buffer.from(svgSource, "utf8").toString("base64")`.
// There's no build step wiring this to the source file, so if the logo
// changes, regenerate this constant by hand.
export const LOGO_LOCKUP_LIGHT_DATA_URI =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMjQiIHdpZHRoPSIxMjAiIGhlaWdodD0iMjQiIHJvbGU9ImltZyIgYXJpYS1sYWJlbD0iU3VTZWVPUyIgc3R5bGU9ImNvbG9yOiMzQjJCMjciPgogIDxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBvcGFjaXR5PSIuNDIiPgogICAgPHBhdGggZD0iTTEuNCAxMS40aDIuNCI+PC9wYXRoPjxwYXRoIGQ9Ik0yLjUgMTQuNmgxLjYiPjwvcGF0aD4KICA8L2c+CiAgPHBhdGggZD0iTTEuOSAzLjNoMS43bDEuMSAzLjUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjIuMSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48L3BhdGg+CiAgPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9ImN1cnJlbnRDb2xvciIgZD0iTTguNCA2LjJoOS4yYTMuNiAzLjYgMCAwIDEgMy42IDMuNnYzYTMuNiAzLjYgMCAwIDEtMy42IDMuNkg4LjRhMy42IDMuNiAwIDAgMS0zLjYtMy42di0zYTMuNiAzLjYgMCAwIDEgMy42LTMuNlptNSAxLjZhMy41IDMuNSAwIDEgMCAwIDcgMy41IDMuNSAwIDAgMCAwLTdaIj48L3BhdGg+CiAgPGNpcmNsZSBjeD0iMTMuNCIgY3k9IjExLjMiIHI9IjIuNTUiIGZpbGw9ImN1cnJlbnRDb2xvciI+PC9jaXJjbGU+CiAgPGNpcmNsZSBjeD0iOS4zIiBjeT0iMTkuOSIgcj0iMS44IiBmaWxsPSJjdXJyZW50Q29sb3IiPjwvY2lyY2xlPgogIDxjaXJjbGUgY3g9IjE3LjEiIGN5PSIxOS45IiByPSIxLjgiIGZpbGw9ImN1cnJlbnRDb2xvciI+PC9jaXJjbGU+CiAgPHRleHQgeD0iMjciIHk9IjE4LjQiIGZvbnQtZmFtaWx5PSInUHVibGljIFNhbnMnLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXdlaWdodD0iODAwIiBmb250LXNpemU9IjE4IiBsZXR0ZXItc3BhY2luZz0iLTAuNyIgZmlsbD0iIzNCMkIyNyI+U3VTZWU8dHNwYW4gZmlsbD0iI0E2MjAzQSI+T1M8L3RzcGFuPjwvdGV4dD4KPC9zdmc+";
