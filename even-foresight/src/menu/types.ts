export interface MenuEntry {
  id: string;
  name: string;
  activate: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export interface MenuSystem {
  show(): Promise<void>;
  hide(): Promise<void>;
  moveDown(): void;
  moveUp(): void;
  select(): Promise<void>;
  readonly isVisible: boolean;
  /** Cancel the auto-dismiss timer. Call on app shutdown. */
  dispose(): void;
}
