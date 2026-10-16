# Display & UI System

*Canvas, containers, text, lists, images, and font support on the Even G2 glasses.*

Source: https://hub.evenrealities.com/docs/build/display

> **Last updated:** 2026-08-25

The glasses don't render arbitrary HTML. They composite a fixed canvas from a small set of SDK container objects, each placed by absolute pixel coordinates.

## Canvas

Each eye displays a **576 x 288 pixel** canvas. The coordinate origin is the top-left corner. X increases to the right; Y increases downward.

Color is **4-bit greyscale** - 16 levels of green. White pixels show as bright green; black pixels are off (transparent).

## Containers

The UI is built from **containers** - rectangular regions placed by absolute pixel coordinates. No CSS, no flexbox, no DOM.

Rules:

- At most **4 image containers** and **8 other containers** per page (mix freely).
- Exactly **one** container has `isEventCapture: 1`. It receives all input events.
- Containers can overlap. `zOrderIndex` controls stacking explicitly (SDK `0.0.12+`) - see [Stacking order](#stacking-order-zorderindex). Pages that omit it keep the old rule: later declarations draw on top.

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
| `zOrderIndex` | number | unique per page | Stacking - larger renders in front (SDK `0.0.12+`). **All-or-nothing per page** - see [Stacking order](#stacking-order-zorderindex) |

### Border properties

Available on text and list containers only:

| Property | Type | Range | Notes |
| --- | --- | --- | --- |
| `borderWidth` | number | 0–5 | 0 = no border |
| `borderColor` | number | 0–15 / 0–16 | Greyscale level |
| `borderRadius` | number | 0–10 | Rounded corners (note: typo preserved from SDK protobuf) |
| `paddingLength` | number | 0–32 | Uniform padding on all sides |

> There is no background or fill property. The border is the only visual decoration.

### Stacking order (`zOrderIndex`)

List, text, and image containers take an optional `zOrderIndex` (SDK `0.0.12+`) in both `createStartUpPageContainer` and `rebuildPageContainer`. Larger values render closer to the front.

Rules:

- **All-or-nothing.** If any container on a page sets `zOrderIndex`, every list, text, and image container on that page must set it. Omit it on all of them and the page keeps declaration-order stacking.
- **Unique per page.** No two containers on the same page may share a value. There is no same-value tie-break.
- **Rendering only.** `zOrderIndex` doesn't touch input routing - the `isEventCapture` rule (exactly one per page) applies unchanged.

Violations never reach the glasses: the SDK validates before calling native, logs an `EvenHubPageContainerValidationErrorCode` error, and `createStartUpPageContainer` returns `StartUpPageCreateResult.invalid` (`rebuildPageContainer` returns `false`).

The layout this unlocks - an image as the backdrop, text floating in front, stable across rebuilds:

```typescript
await bridge.createStartUpPageContainer({
  containerTotalNum: 2,
  imageObject: [{
    xPosition: 144,
    yPosition: 72,
    width: 288,
    height: 144,
    containerID: 1,
    containerName: 'backdrop',
    zOrderIndex: 1, // back
  }],
  textObject: [{
    xPosition: 168,
    yPosition: 112,
    width: 240,
    height: 64,
    containerID: 2,
    containerName: 'caption',
    content: 'Now playing',
    isEventCapture: 1,
    zOrderIndex: 2, // front
  }],
})
```

The image container starts empty - push pixels with `updateImageRawData` after the page is created.

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
  textColor: 4,
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

### Text brightness (`textColor`)

Text containers take an optional `textColor` (SDK `0.0.14+`) - **five brightness levels, `0` to `4`**. Despite the field name there is no color here: the display is monochrome green, and `textColor` sets how bright the glyphs burn.

This is per-container text brightness. It is not the global display brightness the user sets from the system [contextual menu](/docs/build/contextual-menu#slots) - that one is OS-owned and never reaches your app.

| Context | Omit it and you get |
| --- | --- |
| `createStartUpPageContainer` / `rebuildPageContainer` | Device default, level **4** (brightest) |
| `textContainerUpgrade` | The container's **current** brightness, unchanged |

```typescript
// Dim secondary text, full-brightness heading
await bridge.textContainerUpgrade(new TextContainerUpgrade({
  containerID: 2,
  containerName: 'caption',
  content: 'Updated 3 min ago',
  textColor: 2,
}))
```

Two things to keep straight:

- **`textColor` is 0-4. `borderColor` is 0-15.** Different scales on the same container - the border keeps the 16-level greyscale range, text brightness does not.
- **Level `0` is the dimmest level, not "unset".** The SDK accepts it, so a `textColor: 0` container may render effectively invisible. Verify on hardware before shipping a design that relies on `0`.

Values outside `0..4` never reach the glasses: the SDK logs `INVALID_TEXT_BRIGHTNESS` and the call fails locally, the same way z-order violations do. `textContainerUpgrade` rejects out-of-range values before calling the host too.

### In-place updates

Reach for `textContainerUpgrade` - it's faster than a full rebuild and flicker-free on hardware. Pass a `TextContainerUpgrade` instance. `containerID`, `containerName`, and `content` are the only required fields for a basic update; `contentOffset` and `contentLength` are for partial-string updates, and `textColor` re-brightens the text (SDK `0.0.14+`, see [Text brightness](#text-brightness)).

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

- Up to **288 x 144 px** per container (width x height).
- 4-bit greyscale.
- Accepts `number[]`, `Uint8Array`, `ArrayBuffer`, or base64.
- **Cannot send during `createStartUpPageContainer`** - create a placeholder, then update via `updateImageRawData`.
- No concurrent image sends.
- Raw data is LZ4-compressed in transit automatically (SDK `0.0.12+`) - zero code change. Transfers shrink and image updates land faster.

### Image sends are paced at 100ms

Each `updateImageRawData` holds the image path for **100ms** (SDK `0.0.14+`). A call that arrives inside that window is held and flushed on the next one - nothing is dropped, and nothing arrives early.

Treat 100ms as a floor, not a frame budget. A single frame still takes far longer than that to cross BLE, so the pacing is rarely your bottleneck - it's a guard against bursts, not a throughput target.

Keep awaiting each send. `updateImageRawData` resolves to an `ImageRawDataUpdateResult` and you should still check it, but read it as a call result rather than a delivery receipt from the glasses - a `success` means the update was accepted, not that the pixels are lit.

**Image-first apps:** put a full-screen text container with `content: ' '` and `isEventCapture: 1` *behind* the image container - lower `zOrderIndex`, or declared first if the page omits `zOrderIndex`. The text container collects input; the image draws on top.

## Font and Unicode support

The glasses ship a single LVGL font baked into firmware. No font selection, no size control, not monospaced. Characters outside the font set are silently dropped.

The [Useful Characters for Building UIs](/docs/build/design-guidelines#useful-characters-for-building-uis) section of the design guidelines has a lookup table of glyphs that ship in the set.
