/**
 * Foresight — Entry Point
 *
 * One page, two audiences. Inside the Even app this file runs in a WebView:
 * the HTML DOM is what the wearer sees on their phone, while the SDK bridge
 * drives the 576x288 glasses display. Both halves share a single
 * localStorage, so a config saved on the phone reaches the glasses through
 * the bridge plus a same-document `foresight-config-changed` event.
 *
 * Opened in a plain browser there is no bridge, so only the phone UI runs.
 */

import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { startGlassesRuntime } from "./glasses/runtime";
import { createDebugLog } from "./webapp/debug-log";
import { mountPhoneUI } from "./webapp/phone-ui";

function isEvenAppEnvironment(): boolean {
  return typeof (window as any).flutter_inappwebview !== "undefined";
}

let booted = false;

async function init(): Promise<void> {
  if (booted) return;
  booted = true;

  const debugLog = createDebugLog(
    document.getElementById("input-debug-log"),
    document.getElementById("input-debug-toggle"),
  );

  if (!isEvenAppEnvironment()) {
    // Plain browser: no bridge, so configs persist to browser localStorage
    // only and nothing renders to glasses.
    mountPhoneUI(null);
    return;
  }

  let bridge: EvenAppBridge;
  try {
    bridge = await waitForEvenAppBridge();
  } catch (err) {
    console.error("[Foresight] Bridge unavailable:", err);
    mountPhoneUI(null);
    return;
  }

  mountPhoneUI(bridge);

  try {
    await startGlassesRuntime({ bridge, log: debugLog.append });
  } catch (err) {
    // The phone UI stays usable, but the HUD is dead — make that loud rather
    // than swallowing it, which previously hid real glasses-side failures.
    console.error("[Foresight] Glasses runtime failed to start:", err);
    debugLog.append(`GLASSES INIT FAILED: ${(err as Error)?.message ?? err}`);
  }
}

void init();
