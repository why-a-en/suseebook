# Assets

## Logo — authored for this system

No logo was supplied with the brief; this one was designed here, on request:
**a rounded, engineered cart in motion with a dollar coin riding inside the
basket.** Product moving, money counted — the two things the tool exists to keep
straight. Two short motion strokes trail the cart at 42% opacity.

The basket is a solid capsule (3.6-unit corners on the 24 grid) with a circular
cut-out punched through it; the coin sits in that cut-out, so a ring of whatever
is behind the mark separates coin from basket on any surface. Everything but the
motion strokes and the handle is solid fill, which is what lets it survive at
favicon size. The cart carries the ink colour; the coin always carries the accent,
and the `$` is set in the accent's ink colour.

| File | Use |
|---|---|
| `logo-mark-dark.svg` | Mark on dark surfaces (24×24 grid, scales freely) |
| `logo-mark-light.svg` | Mark on light surfaces |
| `logo-mark-mono.svg` | Single-colour `currentColor` mark — the coin becomes an outline so it still separates. Favicons, stamps, embroidery |
| `logo-lockup-dark.svg` | Mark + wordmark, dark surfaces |
| `logo-lockup-light.svg` | Mark + wordmark, light surfaces |

**On the web, do not use the lockup files.** An `<img src="*.svg">` is an isolated
document and cannot see the page's webfonts, so the wordmark falls back to Helvetica.
Use `components/core/Logo.jsx` (or inline the same markup with HTML text) — it
draws the geometry inline, sets the wordmark in real Public Sans 800, and picks up the theme
automatically. The lockup SVGs are for contexts that rasterise them with fonts
resolved: print, decks, favicons, third-party uploads.

The mark files have no text and are safe as `<img>` anywhere.

### Rules

- Wordmark is **Public Sans 800**, 18px on the 24px grid, tracked `-0.7`. "OS"
  always takes the accent; "SuSee" always takes the ink colour. (It was Gloock;
  the serif was pulled from the system.)
- Clear space on all sides = the coin's diameter, 5.7 units on the 24 grid.
- **Minimum mark size 16px**; minimum lockup width 120px (the lockup's own box is
  120×24 units — it widened from 116 when the wordmark went from "Mini POS" to
  "SuSeeOS"). Below that, mark alone.
- The coin is never any colour but `--accent`, and the `$` never any colour but
  `--accent-ink`.
- Never fill the cut-out ring — the coin must always read as sitting *in* the
  basket, not printed on it.
- Never add a container, never rotate, never convert the solid basket to an
  outline, never place the lockup on a photograph, never remove the motion strokes.
- The `$` is a `<text>` glyph in Helvetica/Arial, not a path. Convert it to
  outlines before sending the files anywhere that may lack those faces.

## Iconography

Lucide v0.462.0, loaded from unpkg — a flagged substitution. See `readme.md`
§ICONOGRAPHY.
