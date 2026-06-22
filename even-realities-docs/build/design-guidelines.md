# UI/UX Design Guidelines

*Designing for the 576x288 glasses display.*

Source: https://hub.evenrealities.com/docs/build/design-guidelines

> **Last updated:** 2026-06-11

Even Realities publishes the canonical software design guidelines - layout, components, interaction patterns, and visual standards - for both the glasses display and the companion app.

**[Open the Design Guidelines in Figma →](https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782&t=r9P3fmZ2C2glMlQ9-1)**

## Display constraints

Designing for the G2 display:

- **576 x 288 px canvas.** The whole canvas is renderable. Coordinate origin is top-left; X increases rightward, Y downward.

- **4-bit greyscale.** Design in shades of grey; the hardware renders them as shades of green.

- **No background fill.** Borders and text or image content are the only structure available.

- **Max 4 image containers, 8 other containers.** Plan the layout inside that ceiling.

- **One event-capturing container.** Design around a single active input target.

## Designing icons

- **Native resolution.** Work at the actual pixel size (24 x 24 is the norm). Don't design large and scale down.

- **Simple silhouettes.** Recognizable at a glance beats internal detail.

- **Test on hardware.** Green-tinted greyscale on the glasses looks different from greyscale on a desktop monitor. Verify icon legibility on the actual display, or in the simulator with glow on.

## Common UI patterns

| Pattern | How |
| --- | --- |
| Fake buttons | Prefix text with `>` as a cursor indicator |
| Selection highlight | Toggle `borderWidth` on individual text containers |
| Multi-row layout | Stack multiple text containers vertically (e.g., 3 containers at 96px height) |
| Progress bars | Use Unicode block characters: `━` and `─` |
| Page flipping | Pre-paginate text at ~400–500 character boundaries, rebuild on scroll events |

## Useful characters for building UIs

The glasses render a single LVGL font with no monospaced variant and no sizing controls (see [Font and Unicode support](https://hub.evenrealities.com/docs/build/display#font-and-unicode-support)). The characters below render reliably and stand in for common UI affordances:

| Use case | Characters |
| --- | --- |
| Progress bars | `━` `─` `█▇▆▅▄▃▂▁` |
| Navigation | `▲△▶▷▼▽◀◁` |
| Selection | `●○` `■□` `★☆` |
| Borders | `╭╮╯╰` `│─` box-drawing set |
| Card suits | `♠♣♥♦` |

Full glyph tables live in the [community G2 notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md).

