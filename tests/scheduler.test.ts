import { describe, it, expect } from 'vitest';
import { ActionScheduler, type SessionContext } from '../src/behavior/ActionScheduler.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';

describe('ActionScheduler Behavior & Anti-Repetition Rules', () => {
  const scheduler = new ActionScheduler(DEFAULT_CONFIG);

  const baseContext: SessionContext = {
    pagesReadInCurrentSession: 0,
    sessionStartTime: Date.now(),
    lastAction: null,
    lastProfileVisitTimestamp: 0,
    lastCategoryVisitTimestamp: 0,
    lastBreakTimestamp: 0,
  };

  it('should never repeat consecutive scroll_around actions', () => {
    const context: SessionContext = {
      ...baseContext,
      pagesReadInCurrentSession: 100, // fatigued, high scroll weight normally
      lastAction: 'scroll_around',
    };

    for (let i = 0; i < 50; i++) {
      const scheduled = scheduler.getNextAction(context);
      expect(scheduled.type).not.toBe('scroll_around');
    }
  });

  it('should strictly avoid back-to-back breaks within cooldown period', () => {
    const context: SessionContext = {
      ...baseContext,
      pagesReadInCurrentSession: 120,
      lastAction: 'scroll_around',
      lastBreakTimestamp: Date.now() - 2 * 60_000, // Break 2 minutes ago (< 8 min cooldown)
    };

    for (let i = 0; i < 50; i++) {
      const scheduled = scheduler.getNextAction(context);
      expect(scheduled.type).not.toBe('short_break');
      expect(scheduled.type).not.toBe('long_break');
    }
  });

  it('should never repeat consecutive browse_manga or other non-reading actions', () => {
    const context: SessionContext = {
      ...baseContext,
      lastAction: 'browse_manga',
    };

    for (let i = 0; i < 50; i++) {
      const scheduled = scheduler.getNextAction(context);
      expect(scheduled.type).not.toBe('browse_manga');
    }
  });

  it('should assign reasonable pages to read when read_pages is scheduled', () => {
    const context: SessionContext = {
      ...baseContext,
      lastAction: 'short_break',
    };

    for (let i = 0; i < 20; i++) {
      const scheduled = scheduler.getNextAction(context);
      if (scheduled.type === 'read_pages') {
        expect(scheduled.pagesToRead).toBeGreaterThanOrEqual(30);
        expect(scheduled.pagesToRead).toBeLessThanOrEqual(100);
      }
    }
  });
});
