import { describe, it, expect } from 'vitest';
import {
  AppConfigSchema,
  MangaEntrySchema,
  MangaQueueSchema,
  ReadingProgressRecordSchema,
  ReadingProgressMapSchema,
} from '../src/config/schemas.js';

describe('Configuration & Data Schemas', () => {
  describe('AppConfigSchema', () => {
    it('should generate secure default configuration values when passed an empty object', () => {
      const config = AppConfigSchema.parse({});

      expect(config.runMode).toBe('headless');
      expect(config.readingSpeed).toBe('normal');
      expect(config.readingDirection).toBe('auto');
      expect(config.intervalMs).toBe(15_000);
      expect(config.variationPercent).toBe(45);
      expect(config.mode).toBe('keyboard');
      expect(config.behavior.weights.read_pages).toBe(65);
      expect(config.antiDetection.useRealChrome).toBe(true);
    });

    it('should correctly override specific fields while maintaining defaults for omitted fields', () => {
      const config = AppConfigSchema.parse({
        runMode: 'headed',
        readingSpeed: 'fast',
        intervalMs: 8_000,
      });

      expect(config.runMode).toBe('headed');
      expect(config.readingSpeed).toBe('fast');
      expect(config.intervalMs).toBe(8_000);
      expect(config.variationPercent).toBe(45);
    });

    it('should reject invalid values out of bounds', () => {
      expect(() =>
        AppConfigSchema.parse({
          intervalMs: -100,
        })
      ).toThrow();

      expect(() =>
        AppConfigSchema.parse({
          readingSpeed: 'super_fast' as any,
        })
      ).toThrow();
    });
  });

  describe('MangaQueueSchema', () => {
    it('should assign default status and priority to minimal manga entry', () => {
      const parsed = MangaEntrySchema.parse({
        url: 'https://yupmanga.com/series/berserk',
        title: 'Berserk',
      });

      expect(parsed.status).toBe('queued');
      expect(parsed.priority).toBe(1);
      expect(typeof parsed.addedAt).toBe('string');
    });

    it('should validate an array of manga entries properly', () => {
      const queue = MangaQueueSchema.parse([
        { url: 'https://yupmanga.com/series/one-piece', title: 'One Piece' },
        { url: 'https://yupmanga.com/series/naruto', title: 'Naruto', priority: 2 },
      ]);

      expect(queue).toHaveLength(2);
      expect(queue[0]?.title).toBe('One Piece');
      expect(queue[1]?.priority).toBe(2);
    });
  });

  describe('ReadingProgressMapSchema', () => {
    it('should assign safe default progress counters', () => {
      const progress = ReadingProgressMapSchema.parse({
        'https://yupmanga.com/series/berserk': {
          url: 'https://yupmanga.com/series/berserk',
          title: 'Berserk',
        },
      });

      const entry = progress['https://yupmanga.com/series/berserk'];
      expect(entry).toBeDefined();
      expect(entry?.totalVolumesCompleted).toBe(0);
      expect(entry?.lastPage).toBe(1);
      expect(entry?.sessionsCount).toBe(0);
      expect(entry?.totalPagesReadAccumulated).toBe(0);
    });
  });
});
