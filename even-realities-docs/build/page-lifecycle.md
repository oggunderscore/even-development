# Page Lifecycle

*Creating, updating, rebuilding, and exiting pages.*

Source: https://hub.evenrealities.com/docs/build/page-lifecycle

> **Last updated:** 2026-06-11

Every glasses screen flows through a small set of SDK calls - one for creation, two for updating, one for shutting down.

## Methods

| Method | Purpose | Notes |
| --- | --- | --- |
| `createStartUpPageContainer` | Create the initial page | Called exactly once at startup. Returns result code. |
| `rebuildPageContainer` | Replace the entire page | Full redraw - all state is lost, brief flicker on hardware. |
| `textContainerUpgrade` | Update text in-place | Faster, flicker-free on hardware. Requires matching `containerID` + `containerName`. |
| `updateImageRawData` | Update an image container | No concurrent sends allowed. |
| `shutDownPageContainer` | Exit the app | Pass `1` for the system exit-confirmation dialog (**required on the root page**); pass `0` for immediate exit (internal pages only). |
| `callEvenApp` | Generic method call | Escape hatch - all typed methods are wrappers around this. |

## Result codes

For `createStartUpPageContainer`:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Invalid parameters |
| 2 | Oversize |
| 3 | Out of memory |

`rebuildPageContainer`, `textContainerUpgrade`, and `shutDownPageContainer` return `boolean`.

`updateImageRawData` returns a status string: `success`, `imageException`, `imageSizeInvalid`, `imageToGray4Failed`, or `sendFailed`.

## Best practices

- **Always call `shutDownPageContainer(1)` from the root page.** Mode `1` shows the system exit-confirmation dialog. QA reviewers explicitly check for it. Apps that exit silently with mode `0` from the root - or use a custom in-app exit UI in its place - get rejected. Mode `0` is only OK on internal pages where the user already confirmed.

- Use `textContainerUpgrade` for frequent text updates (counters, status, live data). It skips the flicker of a full rebuild.

- Use `rebuildPageContainer` only when the layout itself changes - adding or removing containers, switching between text and list.

- Match `containerID` and `containerName` exactly when calling `textContainerUpgrade`. Mismatches silently no-op.

- Don't call `updateImageRawData` concurrently. Wait for one to resolve before sending the next.

