# @jappyjan/even-better-sdk — Reference

**npm:** `@jappyjan/even-better-sdk`  
**Latest version:** 0.0.11 (Mar 25, 2026)  
**Author:** jappyjan (mail@janjaap.de)  
**Type:** ES Module with TypeScript declarations  
**Wraps:** `@evenrealities/even_hub_sdk`

---

## What it is

A lightweight opinionated wrapper over the official Even Hub SDK. Adds:
- Page + element composition API (fluent builder style)
- Partial text updates (only re-renders elements whose content changed)
- Singleton SDK initialization (waits for the Even Hub bridge automatically)
- Storage convenience helpers
- Configurable logging

---

## Install

```
npm install @jappyjan/even-better-sdk
```

**Peer runtime requirement:** the Even Hub app bridge must be available at runtime. The SDK queues renders until the bridge is ready.

---

## Quick Start

```ts
import { EvenBetterSdk } from '@jappyjan/even-better-sdk';

const sdk = new EvenBetterSdk();
const page = sdk.createPage('example-page');

page
  .addTextElement('Hello from Even Better SDK')
  .setPosition(pos => pos.setX(12).setY(20))
  .setSize(size => size.setWidth(240).setHeight(60));

await page.render();
```

---

## API Reference

### `EvenBetterSdk`

The main entry point. Manages a shared bridge connection, page registry, render queue, and event listeners.

```ts
class EvenBetterSdk {
  // Static: configure logging before instantiation
  static setLogger(logger: EvenBetterLoggerImplementation): void;
  static setLogLevel(level: EvenBetterLogLevel): void;

  // Static: access the raw bridge if needed
  static getRawBridge(): Promise<EvenAppBridge>;
  static get bridge(): EvenAppBridge | null;

  // Instance
  createPage(identifier: string): EvenBetterPage;
  get isInitialized(): boolean;

  // Storage helpers (wrap Even Hub local storage)
  getValue(key: string): Promise<string>;
  setValue(key: string, value: string): Promise<void>;

  // Event listeners (receives EvenHubEvent from the bridge)
  addEventListener(listener: EventListener): void;
  removeEventListener(listener: EventListener): void;

  // Render a page manually (page.render() calls this internally)
  renderPage(page: EvenBetterPage): Promise<void>;
}

type EventListener = (event: EvenHubEvent) => void;
```

---

### `EvenBetterPage`

Created via `sdk.createPage(id)`. Holds a list of elements and knows how to push them to the bridge.

```ts
class EvenBetterPage {
  readonly id: string;

  // Add elements (returns the new element for chaining)
  addTextElement(content: string): EvenBetterTextElement;
  addListElement(items: string[]): EvenBetterListElement;

  // Designate one element to receive touch/tap events
  setEventCaptureElement(element: EvenBetterElement): void;

  // Push layout to Even Hub — does partial updates when only text content changed
  render(): Promise<void>;

  // Introspection
  getElements(): EvenBetterElement[];
  toEvenSdkPage(): CreateStartUpPageContainer;  // raw Even Hub SDK type
}
```

---

### `EvenBetterElement` (abstract base)

All elements share these fluent setters. Each setter returns `this` for chaining.

```ts
abstract class EvenBetterElement {
  readonly type: EvenBetterElementType;  // 'text' | 'list'
  readonly id: number;                   // auto-assigned integer

  setPosition(setter: (position: EvenBetterElementPosition) => void): EvenBetterElement;
  setSize(setter: (size: EvenBetterElementSize) => void): EvenBetterElement;
  markAsEventCaptureElement(): EvenBetterElement;

  abstract get didChange(): boolean;
  toEvenSdkElement(): BaseContainerProperty;
}

enum EvenBetterElementType {
  LIST = 'list',
  TEXT = 'text',
}
```

---

### `EvenBetterTextElement`

Supports **partial updates** — calling `render()` after `setContent()` only sends a diff rather than re-rendering the whole page.

```ts
class EvenBetterTextElement extends EvenBetterElement {
  setContent(content: string): EvenBetterTextElement;
  setBorder(setter: (border: Border) => void): EvenBetterTextElement;

  get didChange(): boolean;
  updateWithEvenHubSdk(): Promise<boolean>;  // internal, called during render
  toEvenSdkElement(): TextContainerProperty;
}
```

---

### `EvenBetterListElement`

```ts
class EvenBetterListElement extends EvenBetterElement {
  // Mutate items — all return `this` for chaining
  addItem(item: string): EvenBetterListElement;
  removeItem(index: number): EvenBetterListElement;
  setItems(items: string[]): EvenBetterListElement;
  replaceItem(index: number, item: string): EvenBetterListElement;

  // Style
  setBorder(setter: (border: Border) => void): EvenBetterListElement;
  setItemWidth(width: number): EvenBetterListElement;
  setIsItemSelectBorderEn(enabled: boolean): EvenBetterListElement;

  get didChange(): boolean;
  toEvenSdkElement(): ListContainerProperty;
}
```

---

### Position and Size helpers

```ts
class EvenBetterElementPosition {
  setX(x: number): EvenBetterElementPosition;
  setY(y: number): EvenBetterElementPosition;
  get x(): number;
  get y(): number;
}

class EvenBetterElementSize {
  static MAX_WIDTH: number;
  static MAX_HEIGHT: number;

  setWidth(width: number): EvenBetterElementSize;
  setHeight(height: number): EvenBetterElementSize;
  get width(): number;
  get height(): number;
}
```

---

### Logging

```ts
type EvenBetterLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

type EvenBetterLoggerImplementation = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
};

// Configure before creating an EvenBetterSdk instance
EvenBetterSdk.setLogLevel('debug');
EvenBetterSdk.setLogger({
  info:  msg => console.info(msg),
  warn:  msg => console.warn(msg),
  error: msg => console.error(msg),
  debug: msg => console.debug(msg),
});
```

---

## Usage Patterns

### Pages and elements

```ts
const sdk = new EvenBetterSdk();
const page = sdk.createPage('dashboard');

const title = page.addTextElement('Status: OK');
const list  = page.addListElement(['CPU', 'Memory', 'Disk']);

title
  .setPosition(pos => pos.setX(8).setY(8))
  .setSize(size => size.setWidth(280).setHeight(40));

list
  .setPosition(pos => pos.setX(8).setY(60))
  .setSize(size => size.setWidth(280).setHeight(160));

await page.render();

// Partial update — only the text element re-renders
title.setContent('Status: Warning');
await page.render();
```

### Event capture

```ts
const button = page.addTextElement('Tap me');
button.markAsEventCaptureElement();
await page.render();
```

### Storage

```ts
await sdk.setValue('last-viewed', new Date().toISOString());
const lastViewed = await sdk.getValue('last-viewed');
```

### Listening to Even Hub events

```ts
const handler = (event: EvenHubEvent) => {
  console.log('event', event);
};
sdk.addEventListener(handler);
// later:
sdk.removeEventListener(handler);
```

### Accessing the raw Even Hub bridge

```ts
const bridge = await EvenBetterSdk.getRawBridge();
// bridge is EvenAppBridge from @evenrealities/even_hub_sdk
```

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.0.11 | Mar 25, 2026 | latest |
| 0.0.10 | Feb 28, 2026 | |
| 0.0.9  | Feb 20, 2026 | |
| 0.0.8  | Feb 3, 2026  | |

---

## Dependencies

| Package | Version |
|---------|---------|
| `@evenrealities/even_hub_sdk` | ^0.0.9 |
| `nanoid` | ^3.3.11 |

---

## Notes

- This is a community wrapper, not an official Even Realities package.
- No repository URL is published in the package metadata — source is not publicly available.
- The SDK uses a **render queue** internally so concurrent `render()` calls are serialized.
- `EvenBetterTextElement` supports partial updates via the Even Hub SDK's update API — only the changed text container is re-sent, not the whole page layout.
