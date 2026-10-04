import { z } from 'zod';
import { DEFAULT_CONFIG } from './defaults.js';

export const RunModeSchema = z.enum(['headless', 'offscreen', 'headed']);
export const ReadingModeSchema = z.enum(['keyboard', 'click']);

export const ActionTypeSchema = z.enum([
  'read_pages',
  'scroll_around',
  'short_break',
  'visit_home',
  'visit_profile',
  'visit_categories',
  'browse_manga',
  'long_break',
]);

export const BehaviorConfigSchema = z.object({
  weights: z.record(ActionTypeSchema, z.number()).default(DEFAULT_CONFIG.behavior.weights),
  shortBreakMinMs: z.number().positive().default(DEFAULT_CONFIG.behavior.shortBreakMinMs),
  shortBreakMaxMs: z.number().positive().default(DEFAULT_CONFIG.behavior.shortBreakMaxMs),
  longBreakMinMs: z.number().positive().default(DEFAULT_CONFIG.behavior.longBreakMinMs),
  longBreakMaxMs: z.number().positive().default(DEFAULT_CONFIG.behavior.longBreakMaxMs),
  pagesPerReadingSession: z
    .object({
      min: z.number().positive().default(DEFAULT_CONFIG.behavior.pagesPerReadingSession.min),
      max: z.number().positive().default(DEFAULT_CONFIG.behavior.pagesPerReadingSession.max),
    })
    .default(DEFAULT_CONFIG.behavior.pagesPerReadingSession),
});

export const AntiDetectionConfigSchema = z.object({
  useRealChrome: z.boolean().default(DEFAULT_CONFIG.antiDetection.useRealChrome),
  removeWebdriverFlag: z.boolean().default(DEFAULT_CONFIG.antiDetection.removeWebdriverFlag),
});

export const AppConfigSchema = z.object({
  runMode: RunModeSchema.default(DEFAULT_CONFIG.runMode),
  intervalMs: z.number().positive().default(DEFAULT_CONFIG.intervalMs),
  variationPercent: z.number().min(0).max(100).default(DEFAULT_CONFIG.variationPercent),
  mode: ReadingModeSchema.default(DEFAULT_CONFIG.mode),
  clickSelector: z.string().optional(),
  proxy: z.string().optional(),
  behavior: BehaviorConfigSchema.default(DEFAULT_CONFIG.behavior),
  antiDetection: AntiDetectionConfigSchema.default(DEFAULT_CONFIG.antiDetection),
});

export const MangaStatusSchema = z.enum(['queued', 'reading', 'paused', 'completed']);

export const MangaProgressSchema = z.object({
  lastVolumeTitle: z.string().optional(),
  lastVolumeHref: z.string().optional(),
  lastPage: z.number().optional(),
  totalPages: z.number().optional(),
});

export const MangaEntrySchema = z.object({
  url: z.string().url().or(z.string().min(1)),
  title: z.string().min(1),
  priority: z.number().int().default(1),
  status: MangaStatusSchema.default('queued'),
  addedAt: z.string().default(() => new Date().toISOString()),
  lastReadAt: z.string().optional(),
  progress: MangaProgressSchema.optional(),
});

export const MangaQueueSchema = z.array(MangaEntrySchema);

export const ReadingProgressRecordSchema = z.object({
  url: z.string(),
  title: z.string(),
  totalVolumesCompleted: z.number().int().nonnegative().default(0),
  lastVolume: z.string().optional(),
  lastPage: z.number().int().positive().default(1),
  lastReadTimestamp: z.string().default(() => new Date().toISOString()),
  sessionsCount: z.number().int().nonnegative().default(0),
  totalPagesReadAccumulated: z.number().int().nonnegative().default(0),
});

export const ReadingProgressMapSchema = z.record(z.string(), ReadingProgressRecordSchema);
