export interface BannerNotification {
  id: string;
  text: string;
  duration?: number;
  timestamp: number;
}

export interface BannerSystem {
  push(notification: BannerNotification): void;
  dismiss(): void;
  readonly isVisible: boolean;
}
