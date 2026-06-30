export type HudComponentType = "clock" | "weather" | "reminders";

export interface HudSlotConfig {
  row: 0 | 1;
  col: 0 | 1 | 2 | 3 | 4;
  componentType: HudComponentType | null;
}

export interface HudComponent {
  readonly type: HudComponentType;
  render(): string;
  refresh(): Promise<void>;
  dispose(): void;
}

export interface HudLayoutConfig {
  slots: HudSlotConfig[];
}

export interface HudManager {
  init(bridge: any, config: HudLayoutConfig): Promise<void>;
  rebuild(config: HudLayoutConfig): Promise<void>;
  refreshAll(): Promise<void>;
  pause(): void;
  resume(): void;
  dispose(): void;
}
