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
   * Detects and waits for the pre-reader countdown ad, then clicks #btn-continue
   */
  async handlePreReaderAd(page: Page): Promise<boolean> {
    try {
      const continueBtn = page
        .locator('#btn-continue, a:has-text("Continuar al capítulo"), button:has-text("Continuar al capítulo")')
        .first();

      // Check if either the ad container or the continue button is present on the page
      const hasAdOrBtn =
        (await page.locator('text="Un momento y podrás seguir leyendo"').count()) > 0 ||
        (await page.locator('text=/Espera \\d+ segundos/i').count()) > 0 ||
        (await continueBtn.count()) > 0;

      if (!hasAdOrBtn) return false;

      logger.info('[READER] Interstitial ad detected. Waiting for countdown to finish...');

      // Wait up to 18 seconds for the #btn-continue button to become visible
      await continueBtn.waitFor({ state: 'visible', timeout: 18_000 });

      logger.info('[READER] Button "Continuar al capítulo" is now active. Clicking it...');
      await sleep(uglyRandom(900, 1600));
      await continueBtn.click();

      logger.info('[READER] Successfully clicked "Continuar al capítulo". Transitioning to reader...');
      await page.waitForLoadState('domcontentloaded');
      await sleep(uglyRandom(1500, 2500));

      return true;
    } catch (error) {
      logger.debug({ error }, '[READER] Note on pre-reader ad transition');
      return false;
    }
  }

  /**
   * Robustly extracts current page and total pages ("Pagina X de Y")
   * Handles nested colored/styled spans.
   */
  async getPageInfo(page: Page): Promise<PageInfo | null> {
    try {
      return await page.evaluate(() => {
        const elements = document.querySelectorAll('header, div, p, span');
        for (const el of elements) {
          if (el.children.length > 8) continue;
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

  async isReaderPage(page: Page): Promise<boolean> {
    const info = await this.getPageInfo(page);
    return info !== null;
  }

  async isLastPage(page: Page): Promise<boolean> {
    const info = await this.getPageInfo(page);
    if (!info) return false;
    return info.currentPage >= info.totalPages;
  }

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
   * Reads a block of pages with periodic feedback and safety checks
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

    // Dynamic session variation between 30% and 60%
    const sessionVariation = uglyRandom(30.0, 60.0);

    logger.info(
      `[READER] Starting reading block: target ${targetPagesCount} pages (pace base: 9-18s with +${sessionVariation}% variation)...`
    );

    // Initial check: ensure reader is actually loaded
    let initialInfo = await this.getPageInfo(page);
    if (!initialInfo) {
      logger.info('[READER] Waiting for reader page elements to load...');
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(1500);

        // Double check: if #btn-continue is still visible, click it
        const continueBtn = page.locator('#btn-continue, a:has-text("Continuar al capítulo")').first();
        if (await continueBtn.isVisible().catch(() => false)) {
          logger.info('[READER] Re-clicking "Continuar al capítulo" to ensure entry...');
          await continueBtn.click();
          await page.waitForLoadState('domcontentloaded');
        }

        initialInfo = await this.getPageInfo(page);
        if (initialInfo) break;
      }
    }

    if (!initialInfo) {
      logger.warn('[READER] Cannot detect reader page indicator. Checking if stuck on ad or block page...');
      return {
        pagesRead: 0,
        currentPage: 1,
        totalPages: 1,
        volumeCompleted: false,
      };
    }

    lastInfo = initialInfo;
    logger.info(`[READER] Reader active: Page ${initialInfo.currentPage} of ${initialInfo.totalPages}`);

    while (pagesRead < targetPagesCount) {
      if (signal?.aborted) break;

      const info = await this.getPageInfo(page);
      if (info) {
        lastInfo = info;

        // Periodic feedback: log on first page, every 5 pages, or final page
        if (pagesRead === 0 || pagesRead % 5 === 0 || info.currentPage >= info.totalPages) {
          logger.info(
            `[READER] Progress: Page ${info.currentPage} of ${info.totalPages} (Session: ${pagesRead}/${targetPagesCount} pages)`
          );
        }

        if (info.currentPage >= info.totalPages) {
          logger.info('[READER] Final page of volume reached!');
          volumeCompleted = true;
          await this.closeReader(page);
          break;
        }
      }

      // Base interval between 9.0s and 18.0s per page
      const baseSeconds = uglyRandom(9.0, 18.0);
      const delaySeconds = baseSeconds * (1 + sessionVariation / 100);
      const timeMultiplier = getTimeMultiplier();
      const finalDelayMs = Math.round(delaySeconds * timeMultiplier * 1000);

      await sleep(finalDelayMs, signal);

      await this.turnPage(page, config);
      pagesRead++;
    }

    logger.info(`[READER] Finished reading block: ${pagesRead} pages read in this block.`);

    return {
      pagesRead,
      currentPage: lastInfo.currentPage,
      totalPages: lastInfo.totalPages,
      volumeCompleted,
    };
  }
}
