import { describe, it, expect, vi } from 'vitest';
import {
  WebtoonReader,
  pickDominantPage,
  scrollStepPause,
  crossedProgressMark,
  type WebtoonState,
} from '../src/reader/WebtoonReader.js';
import { ReaderAutomation } from '../src/reader/ReaderAutomation.js';
import { parseSeriesType } from '../src/utils/seriesType.js';
import { MangaEntrySchema } from '../src/config/schemas.js';
import { DEFAULT_CONFIG, WEBTOON_PACE } from '../src/config/defaults.js';
import { logger } from '../src/logger.js';
import type { Page } from 'playwright';

describe('parseSeriesType', () => {
  it('reads the type from series page titles', () => {
    expect(parseSeriesType('Mi querida enemiga en Español - Leer Manhwa Online | YupManga')).toBe('manhwa');
    expect(parseSeriesType('Be Blues en Español - Leer Manga Online | YupManga')).toBe('manga');
    expect(parseSeriesType('2Moons en Español - Leer Novela Online | YupManga')).toBe('novel');
  });

  it('reads the type from catalog card labels', () => {
    expect(parseSeriesType('19 días MANHWA ACTIVO')).toBe('manhwa');
    expect(parseSeriesType('Gatos por dinero NOVELA FINALIZADO')).toBe('novel');
    expect(parseSeriesType('Bad Company MANGA FINALIZADO')).toBe('manga');
  });

  it('ignores the YupManga site name', () => {
    expect(parseSeriesType('Comunidad de lectores | YupManga')).toBeNull();
    expect(parseSeriesType(undefined)).toBeNull();
  });
});

describe('MangaEntrySchema', () => {
  it('keeps the series type and accepts legacy entries without it', () => {
    const base = { url: 'https://www.yupmanga.com/series.php?id=X', title: 'X' };
    expect(MangaEntrySchema.parse({ ...base, type: 'manhwa' }).type).toBe('manhwa');
    expect(MangaEntrySchema.parse(base).type).toBeUndefined();
  });
});

describe('Webtoon helpers', () => {
  it('pickDominantPage returns the page covering most of the viewport', () => {
    const rects = [
      { page: 1, top: -900, bottom: 100 },
      { page: 2, top: 100, bottom: 1100 },
      { page: 3, top: 1100, bottom: 2100 },
    ];
    expect(pickDominantPage(rects, 720)).toBe(2);
    expect(pickDominantPage([], 720)).toBeNull();
  });

  it('scrollStepPause paces each scroll step by seconds per screen', () => {
    expect(scrollStepPause(2, 360, 720)).toBe(1000);
    expect(scrollStepPause(0.1, 100, 720)).toBe(150);
    expect(scrollStepPause(30, 720, 720)).toBe(9000);
  });

  it('fast webtoon pace is quicker than normal', () => {
    // Average screens read per second: slower speeds must read fewer screens per second
    const screensPerSecond = (speed: keyof typeof WEBTOON_PACE) => {
      const s = WEBTOON_PACE[speed].screenSeconds;
      return 2 / (s.min + s.max);
    };
    expect(screensPerSecond('fast')).toBeGreaterThan(screensPerSecond('normal') * 1.8);
    expect(screensPerSecond('normal')).toBeGreaterThan(screensPerSecond('slow'));
    expect(screensPerSecond('slow')).toBeGreaterThan(screensPerSecond('very_slow'));
  });
});

describe('crossedProgressMark', () => {
  it('logs the first page and every multiple of 5, even when pages jump', () => {
    expect(crossedProgressMark(0, 1)).toBe(true);
    expect(crossedProgressMark(1, 3)).toBe(false);
    // Jumping 4 -> 6 skips the exact 5 but still crosses the mark
    expect(crossedProgressMark(4, 6)).toBe(true);
    expect(crossedProgressMark(9, 11)).toBe(true);
    expect(crossedProgressMark(11, 13)).toBe(false);
  });
});

describe('WebtoonReader', () => {
  function makeReader() {
    const base = new ReaderAutomation();
    vi.spyOn(base, 'handlePreReaderAd').mockResolvedValue(false);
    vi.spyOn(base, 'handleAdIfPresent').mockResolvedValue(false);
    const closeSpy = vi.spyOn(base, 'closeReader').mockResolvedValue(true);
    return { reader: new WebtoonReader(base), closeSpy };
  }

  function mockPage(states: WebtoonState[]) {
    let idx = 0;
    return {
      isClosed: () => false,
      evaluate: vi.fn().mockImplementation((_fn: unknown, arg: unknown) => {
        // getState passes the selector; the viewport width probe passes nothing
        if (arg === undefined) return Promise.resolve(1280);
        const s = states[Math.min(idx, states.length - 1)];
        idx++;
        return Promise.resolve(s);
      }),
      mouse: { move: vi.fn().mockResolvedValue(undefined), wheel: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;
  }

  const fastConfig = { ...DEFAULT_CONFIG, readingSpeed: 'fast' as const };
  const state = (currentPage: number, scrollY: number, atBottom = false): WebtoonState => ({
    isWebtoon: true,
    currentPage,
    totalPages: 3,
    scrollY,
    viewportHeight: 720,
    atBottom,
    currentImageHeight: 1000,
  });

  it('scrolls through pages and closes the reader at the end of the chapter', async () => {
    vi.useFakeTimers();
    const { reader, closeSpy } = makeReader();
    const page = mockPage([state(1, 0), state(1, 0), state(2, 400), state(3, 900, true)]);

    const promise = reader.readPages(page, 50, fastConfig);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.volumeCompleted).toBe(true);
    expect(result.pagesRead).toBe(2);
    expect(result.currentPage).toBe(3);
    expect(closeSpy).toHaveBeenCalledOnce();
    expect((page.mouse.wheel as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('stops safely when the scroll position never advances', async () => {
    vi.useFakeTimers();
    const { reader, closeSpy } = makeReader();
    const page = mockPage([state(1, 0)]);

    const promise = reader.readPages(page, 50, fastConfig);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.volumeCompleted).toBe(false);
    expect(result.pagesRead).toBe(0);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('does not report a stuck scroll after scrolling up to re-read a panel', async () => {
    vi.useFakeTimers();
    // Force the 7% re-read branch (and minimum random sizes) on every step
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const warnSpy = vi.spyOn(logger, 'warn');
    const { reader } = makeReader();
    // Each step: state after scrolling up (baseline), then state after scrolling down.
    // The down step lands above the pre-re-read position, which used to be flagged as stuck.
    const page = mockPage([
      state(1, 1000),
      state(1, 700),
      state(1, 900),
      state(1, 600),
      state(3, 1200, true),
    ]);

    const promise = reader.readPages(page, 50, fastConfig);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();
    randomSpy.mockRestore();

    const stuckWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('did not advance'));
    warnSpy.mockRestore();
    expect(stuckWarnings).toHaveLength(0);
    expect(result.volumeCompleted).toBe(true);
    expect(result.pagesRead).toBe(2);
  });
});
