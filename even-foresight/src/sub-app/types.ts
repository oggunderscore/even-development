export type GestureType =
  | "single-tap"
  | "double-tap"
  | "swipe-up"
  | "swipe-down";

export interface GestureEvent {
  type: GestureType;
  timestamp: number;
}

export interface SubApp {
  readonly id: string;
  readonly name: string;
  activate(context: SubAppContext): Promise<void>;
  handleGesture(event: GestureEvent): void;
  cleanup(): Promise<void>;
}

export interface SubAppContext {
  readonly width: 576;
  readonly height: 173;
  readonly yOffset: 115;
  updateContent(containerIndex: number, content: string): Promise<void>;
  requestContainers(count: number): number[];
}

export interface SubAppContainer {
  activate(app: SubApp): Promise<void>;
  deactivate(): Promise<void>;
  readonly activeApp: SubApp | null;
}
