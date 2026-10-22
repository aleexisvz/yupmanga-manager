import type { Page } from 'playwright';
import { SPEED_PROFILES, WEBTOON_PACE } from '../config/defaults.js';
import type { AppConfig } from '../config/types.js';
import { HumanInput } from '../behavior/HumanInput.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom, getTimeMultiplier } from '../utils/delay.js';
import type { ReaderAutomation, ReadingSessionResult } from './ReaderAutomation.js';

// Top-level `const` declared by the site reader script (ReaderCore.js); not a window property
declare const readerApp: { isWebtoon?: boolean; currentPage?: number; totalPages?: number } | undefined;

export const WEBTOON_PAGE_SELECTOR = '#readerContent img.page-image[data-page]';

export interface WebtoonState {
  isWebtoon: boolean;
  currentPage: number;
  totalPages: number;
  scrollY: number;
  viewportHeight: number;
  atBottom: boolean;
  /** Rendered height of the page image currently in view */
  currentImageHeight: number;
}

export interface PageRect {
  page: number;
  top: number;
  bottom: number;
}

/**
 * Picks the page occupying most of the viewport (mirrors the site's own IntersectionObserver tracking)
 */
export function pickDominantPage(rects: PageRect[], viewportHeight: number): number | null {
  let best: { page: number; visible: number } | null = null;
  for (const r of rects) {
    const visible = Math.min(r.bottom, viewportHeight) - Math.max(r.top, 0);
    if (visible > 0 && (!best || visible > best.visible)) {
      best = { page: r.page, visible };
    }
  }
  return best?.page ?? null;
}

/**
 * Milliseconds to linger after scrolling `stepPx`, pacing the reading at `screenSeconds`
 * per full viewport (webtoon images span several screens, so pace by screen, not by image).
 */
export function scrollStepPause(screenSeconds: number, stepPx: number, viewportHeight: number): number {
  const share = viewportHeight > 0 ? stepPx / viewportHeight : 1;
  return Math.round(Math.min(Math.max(screenSeconds * 1000 * share, 150), 9_000));
}

/**
 * Reader for vertical-scroll series (manhwa / webtoon). The site disables keyboard
 * navigation in this mode and tracks progress by the image in view, saving it on each page change.
 */
/**
 * True when the page count crossed a multiple of `every` (pages can jump by more than one
 * per scroll step, so an exact `% every === 0` check would skip progress logs)
 */
export function crossedProgressMark(before: number, after: number, every = 5): boolean {
  return before === 0 || Math.floor(after / every) > Math.floor(before / every);
}

export class WebtoonReader {
  private input = new HumanInput();

  constructor(private reader: ReaderAutomation) {}

  async isWebtoonReader(page: Page): Promise<boolean> {
    const state = await this.getState(page);
    return state?.isWebtoon ?? false;
  }

  async getState(page: Page): Promise<WebtoonState | null> {
    try {
      if (page.isClosed()) return null;
      return await page.evaluate((selector) => {
        const images = Array.from(document.querySelectorAll<HTMLImageElement>(selector));
        if (images.length === 0) return null;

        const app = typeof readerApp !== 'undefined' ? readerApp : undefined;
        const viewportHeight = window.innerHeight;

        // Page with the largest visible area
        let dominant: { page: number; visible: number; height: number } | null = null;
        for (const img of images) {
          const rect = img.getBoundingClientRect();
          const visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
          if (visible > 0 && (!dominant || visible > dominant.visible)) {
            dominant = { page: Number(img.dataset.page), visible, height: rect.height };
          }
        }

        const doc = document.scrollingElement || document.documentElement;
        const appPage = Number(app?.currentPage);

        return {
          isWebtoon: Boolean(app?.isWebtoon),
          currentPage: dominant?.page || (appPage > 0 ? appPage : 1),
          totalPages: Number(app?.totalPages) || images.length,
          scrollY: window.scrollY,
          viewportHeight,
          atBottom: window.scrollY + viewportHeight >= doc.scrollHeight - 8,
          currentImageHeight: dominant?.height || viewportHeight,
        };
      }, WEBTOON_PAGE_SELECTOR);
    } catch {
      return null;
    }
  }

  /**
   * Fallback exit when the reader could not be closed through its buttons: staying inside
   * a finished chapter would make the next cycle "complete" it again forever.
   */
  private async leaveToSeriesPage(page: Page): Promise<void> {
    try {
      const seriesPath = await page.evaluate(() => {
        const id = (window as unknown as { currentSeriesId?: string }).currentSeriesId;
        return id ? `/series.php?id=${encodeURIComponent(id)}` : null;
      });
      if (!seriesPath) {
        logger.warn('[WEBTOON] Could not close the reader and the series page is unknown.');
        return;
      }
      logger.warn('[WEBTOON] Could not close the reader. Navigating back to the series page...');
      await page.goto(new URL(seriesPath, page.url()).toString(), { waitUntil: 'domcontentloaded' });
      await sleep(uglyRandom(1500, 2500));
    } catch (err) {
      logger.debug({ err }, '[WEBTOON] Failed to navigate back to the series page');
    }
  }

  private async waitForReader(page: Page): Promise<WebtoonState | null> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = await this.getState(page);
      if (state) return state;
      await this.reader.handleAdIfPresent(page, 'Webtoon reader');
      await sleep(1500);
    }
    return null;
  }

  async readPages(
    page: Page,
    targetPagesCount: number,
    config: AppConfig,
    signal?: AbortSignal
  ): Promise<ReadingSessionResult> {
    await this.reader.handlePreReaderAd(page);

    const profile = SPEED_PROFILES[config.readingSpeed] || SPEED_PROFILES.normal;
    logger.info(
      `[WEBTOON] Starting vertical reading block: target ${targetPagesCount} pages (Speed: ${profile.icon} ${profile.name} [${profile.badge}])...`
    );

    const initial = await this.waitForReader(page);
    if (!initial) {
      logger.warn('[WEBTOON] Cannot detect webtoon page images. Checking if stuck on ad or block page...');
      return { pagesRead: 0, currentPage: 1, totalPages: 1, volumeCompleted: false };
    }

    logger.info(`[WEBTOON] Reader active: Page ${initial.currentPage} of ${initial.totalPages}`);

    // The wheel only scrolls what is under the cursor: rest the mouse over the strip
    const width = await page.evaluate(() => window.innerWidth).catch(() => 1280);
    await this.input.moveMouse(page, {
      x: width * uglyRandom(0.4, 0.6),
      y: initial.viewportHeight * uglyRandom(0.35, 0.65),
    });

    let state = initial;
    let pagesRead = 0;
    let volumeCompleted = false;
    const pace = WEBTOON_PACE[config.readingSpeed] || WEBTOON_PACE.normal;
    // Seconds per screen for the image in view; redrawn on every new page
    const drawScreenSeconds = () => uglyRandom(pace.screenSeconds.min, pace.screenSeconds.max) * getTimeMultiplier();
    let screenSeconds = drawScreenSeconds();
    let stuckCount = 0;
    const MAX_STUCK_RETRIES = 4;

    while (pagesRead < targetPagesCount) {
      if (signal?.aborted) break;

      if (state.atBottom || state.currentPage >= state.totalPages) {
        // Linger on the last panels before leaving, like finishing a chapter
        await sleep(screenSeconds * 1000 * uglyRandom(1, 1.8), signal);
        logger.info(`[WEBTOON] End of chapter reached (Page ${state.currentPage} of ${state.totalPages}).`);
        volumeCompleted = true;
        if (!(await this.reader.closeReader(page))) {
          await this.leaveToSeriesPage(page);
        }
        break;
      }

      // Occasionally scroll back up a little to re-read a panel
      let baselineScrollY = state.scrollY;
      if (Math.random() < 0.07) {
        await this.input.smoothScroll(page, 'up', uglyRandom(120, 300));
        await sleep(uglyRandom(1000, 2600), signal);
        // Measure the next step from where the re-read left us, not from before it
        baselineScrollY = (await this.getState(page))?.scrollY ?? baselineScrollY;
      }

      const stepPx = state.viewportHeight * uglyRandom(pace.stepFraction.min, pace.stepFraction.max);
      await this.input.readingScroll(page, stepPx, signal, pace.wheelPx);
      await sleep(scrollStepPause(screenSeconds, stepPx, state.viewportHeight), signal);

      const next = await this.getState(page);
      if (!next) {
        logger.warn('[WEBTOON] Lost reader state. Re-checking...');
        await sleep(1500, signal);
        continue;
      }

      if (next.scrollY <= baselineScrollY && !next.atBottom) {
        stuckCount++;
        logger.warn(
          `[WEBTOON] Scroll did not advance at Page ${next.currentPage} of ${next.totalPages} (Attempt ${stuckCount}/${MAX_STUCK_RETRIES}).`
        );
        if (stuckCount >= MAX_STUCK_RETRIES) {
          logger.error('[WEBTOON] Reader cannot scroll further. Halting reading session safely to avoid desync.');
          break;
        }
        await sleep(1500, signal);
      } else {
        if (stuckCount > 0) {
          logger.info(`[WEBTOON] Scroll resumed at Page ${next.currentPage} of ${next.totalPages}.`);
        }
        stuckCount = 0;
      }

      if (next.currentPage > state.currentPage) {
        const pagesBefore = pagesRead;
        pagesRead += next.currentPage - state.currentPage;
        // New image in view: draw a fresh reading pace for it
        screenSeconds = drawScreenSeconds();
        // 10% chance of a human micro-pause when a new page comes into view
        if (Math.random() < 0.1) {
          await sleep(uglyRandom(2000, 5000), signal);
        }
        if (crossedProgressMark(pagesBefore, pagesRead)) {
          logger.info(
            `[WEBTOON] Progress: Page ${next.currentPage} of ${next.totalPages} (Session: ${pagesRead}/${targetPagesCount} pages)`
          );
        }
      }

      state = next;
    }

    logger.info(`[WEBTOON] Finished reading block: ${pagesRead} pages read in this block.`);

    return {
      pagesRead,
      currentPage: state.currentPage,
      totalPages: state.totalPages,
      volumeCompleted,
    };
  }
}
