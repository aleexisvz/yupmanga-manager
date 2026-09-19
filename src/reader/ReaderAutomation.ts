import type { Page } from 'playwright';
import { SELECTORS } from '../config/defaults.js';
import type { AppConfig, PageInfo } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom, getTimeMultiplier } from '../utils/delay.js';

export interface ReadingSessionResult {
  pagesRead: number;
  currentPage: number;
  totalPages: number;
  volumeCompleted: boolean;
}

export class ReaderAutomation {
  /**
   * Detects and waits for the pre-reader countdown ad ("Wait X seconds...")
   */
  async handlePreReaderAd(page: Page): Promise<void> {
    try {
      const adModal = page.locator(SELECTORS.AD_MODAL_CONTAINER);
      const isVisible = await adModal.isVisible({ timeout: 2500 }).catch(() => false);

      if (!isVisible) return;

      logger.info('[READER] Interstitial ad screen detected. Waiting for countdown...');

      const continueBtn = page.locator(SELECTORS.AD_CONTINUE_BUTTON);

      await continueBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
        logger.debug('[READER] Waiting for ad container to dismiss...');
      });

      await sleep(uglyRandom(800, 1800));

      if (await continueBtn.isVisible().catch(() => false)) {
        logger.info('[READER] Clicking continue button to enter reader...');
        await continueBtn.click();
      } else {
        await adModal.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
      }

      await sleep(uglyRandom(1200, 2200));
    } catch (error) {
      logger.debug({ error }, '[READER] Error handling pre-reader ad');
    }
  }

  /**
   * Robustly extracts current page and total pages ("Pagina X de Y")
   * Handles nested colored/styled spans.
   */
  async getPageInfo(page: Page): Promise<PageInfo | null> {
    try {
      return await page.evaluate(() => {
        // Search across potential header/toolbar elements
        const elements = document.querySelectorAll('header, div, p, span');
        for (const el of elements) {
          if (el.children.length > 6) continue; // Skip large page wrappers
          const text = el.textContent || '';
          const match = text.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)/i);
          if (match) {
            return {
              currentPage: parseInt(match[1], 10),
              totalPages: parseInt(match[2], 10),
            };
          }
        }
        return null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Checks whether the current page is actively displaying the reader
   */
  async isReaderPage(page: Page): Promise<boolean> {
    const info = await this.getPageInfo(page);
    return info !== null;
  }

  /**
   * Checks if the reader reached the final page of the volume
   */
  async isLastPage(page: Page): Promise<boolean> {
    const info = await this.getPageInfo(page);
    if (!info) return false;
    return info.currentPage >= info.totalPages;
  }

  /**
   * Advances to next page using real CDP keyboard press or click
   */
  async turnPage(page: Page, config: AppConfig): Promise<void> {
    if (config.mode === 'click' && config.clickSelector) {
      const btn = page.locator(config.clickSelector);
      if (await btn.isVisible()) {
        await btn.click();
        return;
      }
    }

    await page.keyboard.press('ArrowRight');
  }

  /**
   * Closes the reader to return to the manga gallery
   */
  async closeReader(page: Page): Promise<boolean> {
    try {
      const closeBtn = page.locator(SELECTORS.READER_CLOSE_BUTTON).first();
      if (await closeBtn.isVisible({ timeout: 2500 })) {
        logger.info('[READER] Volume finished. Clicking Close to return to gallery...');
        await sleep(uglyRandom(800, 1600));
        await closeBtn.click();
        await page.waitForLoadState('domcontentloaded');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Reads a block of pages with humanized 9s-18s rhythm and 30%-60% variation
   */
  async readPages(
    page: Page,
    targetPagesCount: number,
    config: AppConfig,
    signal?: AbortSignal
  ): Promise<ReadingSessionResult> {
    await this.handlePreReaderAd(page);

    let pagesRead = 0;
    let volumeCompleted = false;
    let lastInfo: PageInfo = { currentPage: 1, totalPages: 1 };

    // Dynamic variation calculated for this reading session between 30% and 60%
    const sessionVariation = uglyRandom(30.0, 60.0);

    logger.info(
      `[READER] Starting reading block: target ${targetPagesCount} pages (session variation: +${sessionVariation}%)...`
    );

    while (pagesRead < targetPagesCount) {
      if (signal?.aborted) break;

      const info = await this.getPageInfo(page);
      if (info) {
        lastInfo = info;
        logger.info(`[READER] Page ${info.currentPage} of ${info.totalPages} (read: ${pagesRead}/${targetPagesCount})`);

        if (info.currentPage >= info.totalPages) {
          logger.info('[READER] Final page of volume reached!');
          volumeCompleted = true;
          await this.closeReader(page);
          break;
        }
      }

      // Base interval between 9.0s and 18.0s per page
      const baseSeconds = uglyRandom(9.0, 18.0);
      // Final delay applying variation percentage: base * (1 + variation/100)
      const delaySeconds = baseSeconds * (1 + sessionVariation / 100);
      const timeMultiplier = getTimeMultiplier();
      const finalDelayMs = Math.round(delaySeconds * timeMultiplier * 1000);

      logger.debug(
        `[READER] Next page in ${(finalDelayMs / 1000).toFixed(2)}s (base: ${baseSeconds}s, var: +${sessionVariation}%)`
      );

      await sleep(finalDelayMs, signal);

      await this.turnPage(page, config);
      pagesRead++;
    }

    return {
      pagesRead,
      currentPage: lastInfo.currentPage,
      totalPages: lastInfo.totalPages,
      volumeCompleted,
    };
  }
}
