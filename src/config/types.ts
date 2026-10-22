export type RunMode = 'headless' | 'offscreen' | 'headed';

export type ReadingMode = 'keyboard' | 'click';

export type ActionType =
  | 'read_pages'
  | 'scroll_around'
  | 'short_break'
  | 'visit_home'
  | 'visit_profile'
  | 'visit_categories'
  | 'browse_manga'
  | 'long_break';

export interface BehaviorConfig {
  weights: Record<ActionType, number>;
  shortBreakMinMs: number;
  shortBreakMaxMs: number;
  longBreakMinMs: number;
  longBreakMaxMs: number;
  pagesPerReadingSession: {
    min: number;
    max: number;
  };
}

export interface AntiDetectionConfig {
  useRealChrome: boolean;
  removeWebdriverFlag: boolean;
}

export type ReadingSpeed = 'very_slow' | 'slow' | 'normal' | 'fast';

export interface SpeedProfile {
  id: ReadingSpeed;
  name: string;
  icon: string;
  description: string;
  minSeconds: number;
  maxSeconds: number;
  badge: string;
}

export type ReadingDirection = 'auto' | 'rtl' | 'ltr';

export interface AppConfig {
  runMode: RunMode;
  readingSpeed: ReadingSpeed;
  readingDirection?: ReadingDirection;
  intervalMs?: number;
  variationPercent?: number;
  mode: ReadingMode;
  clickSelector?: string;
  proxy?: string;
  behavior: BehaviorConfig;
  antiDetection: AntiDetectionConfig;
}

export type SeriesType = 'manga' | 'manhwa' | 'novel';

export type VolumeStatus = 'completed' | 'in-progress' | 'not-started' | 'unknown';

export interface PageInfo {
  currentPage: number;
  totalPages: number;
}

export interface VolumeInfo {
  href: string;
  title: string;
  status: VolumeStatus;
}

export interface MangaEntry {
  url: string;
  title: string;
  type?: SeriesType;
  priority: number;
  status: 'queued' | 'reading' | 'paused' | 'completed';
  addedAt: string;
  lastReadAt?: string;
  progress?: {
    lastVolumeTitle?: string;
    lastVolumeHref?: string;
    lastPage?: number;
    totalPages?: number;
  };
}

export interface ReadingProgressRecord {
  url: string;
  title: string;
  totalVolumesCompleted: number;
  lastVolume?: string;
  lastPage?: number;
  lastReadTimestamp: string;
  sessionsCount: number;
  totalPagesReadAccumulated: number;
}
