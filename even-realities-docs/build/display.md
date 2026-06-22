# Display & UI System

*Canvas, containers, text, lists, images, and font support on the Even G2 glasses.*

Source: https://hub.evenrealities.com/docs/build/display

> **Last updated:** 2026-06-11

The glasses don't render arbitrary HTML. They composite a fixed canvas from a small set of SDK container objects, each placed by absolute pixel coordinates.

## Canvas

Each eye displays a **576 x 288 pixel** canvas. The coordinate origin is the top-left corner. X increases to the right; Y increases downward.

Color is **4-bit greyscale** - 16 levels of green. White pixels show as bright green; black pixels are off (transparent).

## Containers

The UI is built from **containers** - rectangular regions placed by absolute pixel coordinates. No CSS, no flexbox, no DOM.

Rules:

- At most **4 image containers** and **8 other containers** per page (mix freely).

- Exactly **one** container has `isEventCapture: 1`. It receives all input events.

- Containers can overlap; later ones draw on top.

- There is no z-index beyond declaration order.

### Shared properties

| Property | Type | Range | Notes |
| --- | --- | --- | --- |
| `xPosition` | number | 0–576 | Left edge (px) |
| `yPosition` | number | 0–288 | Top edge (px) |
| `width` | number | 0–576 | Container width (px) |
| `height` | number | 0–288 | Container height (px) |
| `containerID` | number | - | Unique per page |
| `containerName` | string | max 16 chars | Unique per page |
| `isEventCapture` | number | 0 or 1 | Exactly one must be `1` |

### Border properties

Available on text and list containers only:

| Property | Type | Range | Notes |
| --- | --- | --- | --- |
| `borderWidth` | number | 0–5 | 0 = no border |
| `borderColor` | number | 0–15 / 0–16 | Greyscale level |
| `borderRadius` | number | 0–10 | Rounded corners (note: typo preserved from SDK protobuf) |
| `paddingLength` | number | 0–32 | Uniform padding on all sides |

> There is no background or fill property. The border is the only visual decoration.

## Text containers

The primary container type. Plain text, left-aligned, top-aligned. No alignment options, no font-size control, no bold or italic.

```typescript
new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'Your text here',
  isEventCapture: 1,
})
```

### Content limits

| Method | Max Characters |
| --- | --- |
| `createStartUpPageContainer` | 1,000 |
| `textContainerUpgrade` | 2,000 |
| `rebuildPageContainer` | 1,000 |

### Behavior

- Text wraps at the container width.

- If content overflows and the container has `isEventCapture: 1`, the firmware scrolls it.

- `\n` is a line break.

- Unicode works as long as the glyph is in the firmware's font set.

- A full-screen text container holds roughly 400-500 characters.

- "Centering" means padding with spaces.

### In-place updates

Reach for `textContainerUpgrade` - it's faster than a full rebuild and flicker-free on hardware. Pass a `TextContainerUpgrade` instance. `containerID`, `containerName`, and `content` are the only required fields for a basic update; `contentOffset` and `contentLength` are for partial-string updates.

```typescript
import { TextContainerUpgrade } from '@evenrealities/even_hub_sdk'

await bridge.textContainerUpgrade(new TextContainerUpgrade({
  containerID: 1,
  containerName: 'main',
  content: 'Updated text',
}))
```

## List containers

Native scrollable lists, with scroll highlighting handled in firmware.

- Up to **20 items** per list.

- Up to **64 characters** per item.

- No per-item styling, no row-height control, no separators.

- No in-place updates - changing a list means rebuilding the whole page.

## Image containers

Render greyscale images.

- Up to **144 x 288 px** per container (width x height).

- 4-bit greyscale.

- Accepts `number[]`, `Uint8Array`, `ArrayBuffer`, or base64.

- **Cannot send during `createStartUpPageContainer`** - create a placeholder, then update via `updateImageRawData`.

- No concurrent image sends.

**Image-first apps:** put a full-screen text container with `content: ' '` and `isEventCapture: 1` *behind* the image container. The text container collects input; the image draws on top.

## Font and Unicode support

The glasses ship a single LVGL font baked into firmware. No font selection, no size control, not monospaced. Characters outside the font set are silently dropped.

The [Useful Characters for Building UIs](https://hub.evenrealities.com/docs/build/design-guidelines#useful-characters-for-building-uis) section of the design guidelines has a lookup table of glyphs that ship in the set.

