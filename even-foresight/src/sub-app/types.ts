/**
 * SubApp SDK contract.
 *
 * Recreated from git history (originally introduced in the "Rework
 * Foresight" commit, deleted in the "Stabilize Foresight" commit as dead
 * code — see the git log for the sub-app/types.ts path).
 * The SmarterEveryday design (`.kiro/specs/smarter-everyday/design.md`,
 * component section 4 and 9) documents this as the existing `SubApp_SDK`
 * contract and builds `createSmarterEverydayApp` against it, so it is
 * restored here as the foundation for that work.
 *
 * `GestureType` is re-exported from `../gesture-router` (rather than
 * redefined) so the SubApp SDK always reflects the current five-value set,
 * including the `"hold"` gesture added for the SmarterEveryday feature.
 */

import type { GestureType } from "../gesture-router";

export type { GestureType };

export interface GestureEvent {
  type: GestureType;
  timestamp: number;
}

/** The interface every sub-app (built-in or third-party) implements. */
export interface SubApp {
  readonly id: string;
  readonly name: string;
  activate(context: SubAppContext): Promise<void>;
  handleGesture(event: GestureEvent): void;
  cleanup(): Promise<void>;
}

/** Rendering surface + gesture-forwarding handle given to a SubApp on activate. */
export interface SubAppContext {
  readonly width: 576;
  readonly height: 173;
  readonly yOffset: 115;
  updateContent(containerIndex: number, content: string): Promise<void>;
  requestContainers(count: number): number[];
}

/** Owns SubApp lifecycle (activation/deactivation) — implemented by the container factory. */
export interface SubAppContainer {
  activate(app: SubApp): Promise<void>;
  deactivate(): Promise<void>;
  readonly activeApp: SubApp | null;
}
