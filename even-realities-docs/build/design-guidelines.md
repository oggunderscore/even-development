# UI/UX Design Guidelines

*Designing for the 576x288 glasses display.*

Source: https://hub.evenrealities.com/docs/build/design-guidelines

> **Last updated:** 2026-07-10

Even Realities publishes the canonical software design guidelines - layout, components, interaction patterns, and visual standards - for both the glasses display and the companion app.

**[Open the Design Guidelines in Figma →](https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782&t=r9P3fmZ2C2glMlQ9-1)**

## Display constraints

Designing for the Even G2 display:

- **576 x 288 px canvas.** The whole canvas is renderable. Coordinate origin is top-left; X increases rightward, Y downward.
- **4-bit greyscale.** Design in shades of grey; the hardware renders them as shades of green.
- **No background fill.** Borders and text or image content are the only structure available.
- **Max 4 image containers, 8 other containers.** Plan the layout inside that ceiling.
- **One event-capturing container.** Design around a single active input target.

## Designing icons

Icons on the Even G2 are pixel art. You don't have to draw them pixel by pixel — design at full size in whatever tool you like, then bring the artwork down to the pixel grid deliberately.

### The workflow

1. **Draw big, in any tool.** Figma, Illustrator, Inkscape, an AI image generator — anything that exports SVG or a high-resolution PNG.
2. **Fill the canvas border to border.** No padding, no margins. At 24 x 24 there are no pixels to spare; empty space in the source becomes wasted pixels on the glasses.
3. **Downscale to native resolution, then clean up by hand.** Scale to the actual render size (24 x 24 is the norm), threshold to pure on/off pixels — no anti-aliasing — and nudge strokes onto the grid. The last 10% is always manual.

### What survives 24 x 24 — and what doesn't

| Do | Don't |
| --- | --- |
| One solid color on a plain background | Gradients, shadows, textures |
| Flat filled shapes | Hairline strokes, outline-style icons |
| A single subject, edge to edge | Busy scenes, multiple elements, decorative borders |
| Strokes at least 2 px wide at final size | Thinner lines — they vanish or clump when downscaled |
| A silhouette recognizable from shape alone | Detail that only reads large: faces, text, fine patterns |

If you use an AI generator for source art, prompt for *flat solid-black icon, white background, thick strokes, no gradients, no shading, centered, fills the frame* — then downscale and clean up as above.

### The store icon

The icon on your store listing is stricter than in-app artwork. It is drawn in the Developer Portal's 24 x 24 pixel editor and validated on upload:

- **1-bit monochrome.** Every pixel is fully on or fully off. No greys, no anti-aliasing.
- **Built from 2 x 2 blocks.** Every lit pixel must be part of a 2 x 2 block of lit pixels. Blocks can sit at any position and chain into bars, corners, and irregular shapes, but the thinnest possible stroke is 2 px — single pixels and 1-px lines don't validate. Plan on an effective 12 x 12 detail budget.

Reviewers also reject illegible icons outright — see [Store listing & visual assets](/docs/ship/app-submission#store-listing-visual-assets).

## Common UI patterns

| Pattern | How |
| --- | --- |
| Fake buttons | Prefix text with `>` as a cursor indicator |
| Selection highlight | Toggle `borderWidth` on individual text containers |
| Multi-row layout | Stack multiple text containers vertically (e.g., 3 containers at 96px height) |
| Progress bars | Use Unicode block characters: `━` and `─` |
| Page flipping | Pre-paginate text at ~400–500 character boundaries, rebuild on scroll events |

## Useful characters for building UIs

The glasses render a single LVGL font with no monospaced variant and no sizing controls (see [Font and Unicode support](/docs/build/display#font-and-unicode-support)). The characters below render reliably and stand in for common UI affordances:

| Use case | Characters |
| --- | --- |
| Progress bars | `━` `─` `█▇▆▅▄▃▂▁` |
| Navigation | `▲△▶▷▼▽◀◁` |
| Selection | `●○` `■□` `★☆` |
| Borders | `╭╮╯╰` `│─` box-drawing set |
| Card suits | `♠♣♥♦` |

Full glyph tables live in the [community Even G2 notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md).
