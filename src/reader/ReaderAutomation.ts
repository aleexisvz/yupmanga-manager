import type { Page } from 'playwright';
import { SELECTORS, SPEED_PROFILES } from '../config/defaults.js';
import type { AppConfig, PageInfo } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom, getTimeMultiplier, calculatePageDelay } from '../utils/delay.js';

export interface ReadingSessionResult {
  pagesRead: number;
  currentPage: number;
  totalPages: number;
  volumeCompleted: boolean;
}

export class ReaderAutomation {
  /**
   * Universal interstitial ad handler (handles both entry ads and exit ads)
   */
  async handleAdIfPresent(page: Page, contextDescription = 'Reader'): Promise<boolean> {
    try {
      if (page.isClosed()) return false;

      const hasAdOrBtn =
        (await page.locator(SELECTORS.AD_CONTINUE_BUTTON).count()) > 0 ||
        (await page.locator(SELECTORS.AD_MESSAGE_TEXT).count()) > 0 ||
        (await page.locator(SELECTORS.AD_COUNTDOWN_TEXT).count()) > 0 ||
        page.url().includes('box-modal') ||
        page.url().includes('interstitial');

      if (!hasAdOrBtn) return false;

      logger.info(`[AD] Interstitial ad detected [${contextDescription}]. Waiting for countdown to finish...`);

      // 1. Wait for countdown to finish: button must be visible, enabled, and active
      try {
        await page.waitForFunction(() => {
          const btn =
            document.getElementById('continueBtn') ||
            document.getElementById('continueBtnMobileTop') ||
            document.querySelector('.continue-button') ||
            document.getElementById('btn-continue') ||
            Array.from(document.querySelectorAll('button, a')).find((el) =>
              el.textContent?.includes('Continuar')
            );
          if (!btn) return false;

          const style = window.getComputedStyle(btn);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (btn.classList.contains('pointer-events-none') || btn.classList.contains('opacity-50')) return false;
          if ((btn as HTMLButtonElement).disabled) return false;

          const bodyText = document.body.innerText || '';
          if (/Espera \d+ segundos/i.test(bodyText) && !btn.classList.contains('is-visible')) {
            return false;
          }

          return true;
        }, { timeout: 20_000 });
      } catch {
        logger.debug('[AD] Countdown wait timeout, attempting to continue directly...');
      }

      logger.info(`[AD] Countdown finished [${contextDescription}]. Clicking continue button...`);
      await sleep(uglyRandom(600, 1200));

      // Click via DOM evaluate first (executes native onclick/navigation)
      await page.evaluate(() => {
        const btn =
          document.getElementById('continueBtn') ||
          document.getElementById('continueBtnMobileTop') ||
          (document.querySelector('.continue-button') as HTMLElement | null) ||
          document.getElementById('btn-continue') ||
          (Array.from(document.querySelectorAll('button, a')).find((el) =>
            el.textContent?.includes('Continuar')
          ) as HTMLElement | null);

        if (btn) {
          btn.click();
          const inner = btn.querySelector('button');
          if (inner) inner.click();
        }
      }).catch(() => {});

      const continueBtn = page.locator(SELECTORS.AD_CONTINUE_BUTTON).first();
      if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click({ force: true }).catch(() => {});
      }

      logger.info(`[AD] Clicked continue button [${contextDescription}]. Transitioning to reader...`);

      // Wait for navigation or reader elements to appear
      try {
        await Promise.race([
          page.waitForURL((url) => !url.href.includes('box-modal') && !url.href.includes('interstitial'), {
            timeout: 10_000,
          }),
          page.waitForSelector(SELECTORS.READER_READY_INDICATORS, {
            timeout: 10_000,
          }),
        ]);
      } catch {
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }

      await sleep(uglyRandom(1500, 2500));
      logger.info(`[AD] Successfully transitioned to reader [${contextDescription}].`);

      return true;
    } catch (error) {
      logger.debug({ error }, '[AD] Note on ad transition');
      return false;
    }
  }

  /**
   * Backward-compatible alias for entry ads
   */
  async handlePreReaderAd(page: Page): Promise<boolean> {
    return this.handleAdIfPresent(page, 'Opening reader');
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
          if (match?.[1] && match?.[2]) {
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
    try {
      if (page.isClosed()) return false;
      const url = page.url();
      if (url.includes('box-modal') || url.includes('chapter') || url.includes('lector') || url.includes('interstitial')) {
        return true;
      }

      // Close button is unique to the reader modal
      const hasCloseBtn = (await page.locator(SELECTORS.READER_CLOSE_BUTTON).count()) > 0;
      if (hasCloseBtn) {
        return true;
      }

      // If on series catalog and no close button, it is the catalog, not the reader
      if (url.includes('series.php') || url.includes('/series/') || url.includes('/manga/')) {
        return false;
      }

      const info = await this.getPageInfo(page);
      return info !== null;
    } catch {
      return false;
    }
  }

  async isLastPage(page: Page): Promise<boolean> {
    const info = await this.getPageInfo(page);
    if (!info) return false;
    return info.currentPage >= info.totalPages;
  }

  /**
   * Detects reading direction hints from DOM attributes or text
   */
  async detectDomReadingDirection(page: Page): Promise<'rtl' | 'ltr' | null> {
    try {
      return await page.evaluate(() => {
        const bodyText = (document.body.innerText || '').toLowerCase();
        const html = document.documentElement;
        if (html.getAttribute('dir') === 'rtl') return 'rtl';

        if (document.querySelector('[data-reading-direction="rtl"], [data-mode*="rtl"], .reading-mode-rtl')) {
          return 'rtl';
        }
        if (document.querySelector('[data-reading-direction="ltr"], [data-mode*="ltr"], .reading-mode-ltr')) {
          return 'ltr';
        }

        if (bodyText.includes('derecha a izquierda') || bodyText.includes('manga (rtl)')) {
          return 'rtl';
        }
        if (
          bodyText.includes('izquierda a derecha') ||
          bodyText.includes('webtoon') ||
          bodyText.includes('cascada') ||
          bodyText.includes('occidental (ltr)')
        ) {
          return 'ltr';
        }

        return null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Advances the reader forward by one page with verification,
   * bidirectional auto-recovery, and reading direction self-calibration.
   */
  async turnPageForward(
    page: Page,
    config: AppConfig,
    currentDirection: 'rtl' | 'ltr'
  ): Promise<{ advanced: boolean; newPage: number; detectedDirection: 'rtl' | 'ltr' }> {
    const beforeInfo = await this.getPageInfo(page);
    if (!beforeInfo) {
      return { advanced: false, newPage: 1, detectedDirection: currentDirection };
    }

    const forwardKey = currentDirection === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const reverseKey = currentDirection === 'rtl' ? 'ArrowRight' : 'ArrowLeft';

    // 1. Ensure reader window and body have active focus
    await page.evaluate(() => {
      window.focus();
      document.body?.focus();
    }).catch(() => {});

    // 2. Custom clickSelector support if in click mode
    if (config.mode === 'click' && config.clickSelector) {
      const btn = page.locator(config.clickSelector).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await sleep(600);
        const afterInfo = await this.getPageInfo(page);
        if (afterInfo && afterInfo.currentPage > beforeInfo.currentPage) {
          return { advanced: true, newPage: afterInfo.currentPage, detectedDirection: currentDirection };
        }
      }
    }

    // 3. Press candidate forward key
    await page.keyboard.press(forwardKey);
    await sleep(600);

    let afterInfo = await this.getPageInfo(page);
    if (!afterInfo) {
      return { advanced: false, newPage: beforeInfo.currentPage, detectedDirection: currentDirection };
    }

    // Case A: Page advanced forward
    if (afterInfo.currentPage > beforeInfo.currentPage) {
      return { advanced: true, newPage: afterInfo.currentPage, detectedDirection: currentDirection };
    }

    // Case B: Page moved backwards! Direction was inverted!
    if (afterInfo.currentPage < beforeInfo.currentPage) {
      const newDirection: 'rtl' | 'ltr' = currentDirection === 'rtl' ? 'ltr' : 'rtl';
      logger.warn(
        `[READER] Page moved backward (${beforeInfo.currentPage} -> ${afterInfo.currentPage}) using [${forwardKey}]. Auto-calibrating orientation to [${newDirection.toUpperCase()}] (Key: ${reverseKey})...`
      );

      // Press the opposite key to recover lost page and advance forward
      await page.keyboard.press(reverseKey);
      await sleep(350);
      await page.keyboard.press(reverseKey);
      await sleep(600);

      afterInfo = await this.getPageInfo(page);
      if (afterInfo && afterInfo.currentPage > beforeInfo.currentPage) {
        return { advanced: true, newPage: afterInfo.currentPage, detectedDirection: newDirection };
      }
      return {
        advanced: false,
        newPage: afterInfo?.currentPage ?? beforeInfo.currentPage,
        detectedDirection: newDirection,
      };
    }

    // Case C: Page did not move (e.g., stuck on Page 1 because forwardKey was actually previous key)
    logger.debug(`[READER] Page did not advance with [${forwardKey}]. Testing opposite key [${reverseKey}]...`);
    await page.keyboard.press(reverseKey);
    await sleep(600);

    afterInfo = await this.getPageInfo(page);
    if (afterInfo && afterInfo.currentPage > beforeInfo.currentPage) {
      const newDirection: 'rtl' | 'ltr' = currentDirection === 'rtl' ? 'ltr' : 'rtl';
      logger.info(
        `[READER] Calibrated reading direction: [${newDirection.toUpperCase()}] (Advanced to Page ${afterInfo.currentPage} via ${reverseKey}).`
      );
      return { advanced: true, newPage: afterInfo.currentPage, detectedDirection: newDirection };
    }

    // Case D: Try visible Next button in reader interface
    const nextBtn = page.locator(SELECTORS.READER_NEXT_BUTTON).first();
    if (await nextBtn.isVisible().catch(() => false)) {
      logger.debug('[READER] Trying navigation via next button selector...');
      await nextBtn.click({ force: true }).catch(() => {});
      await sleep(600);
      afterInfo = await this.getPageInfo(page);
      if (afterInfo && afterInfo.currentPage > beforeInfo.currentPage) {
        return { advanced: true, newPage: afterInfo.currentPage, detectedDirection: currentDirection };
      }
    }

    // Case E: Viewport tap on the forward side of the reader
    try {
      const viewport = page.viewportSize() || { width: 1280, height: 850 };
      const clickX = currentDirection === 'rtl' ? Math.round(viewport.width * 0.15) : Math.round(viewport.width * 0.85);
      const clickY = Math.round(viewport.height * 0.5);
      await page.mouse.click(clickX, clickY);
      await sleep(600);
      afterInfo = await this.getPageInfo(page);
      if (afterInfo && afterInfo.currentPage > beforeInfo.currentPage) {
        return { advanced: true, newPage: afterInfo.currentPage, detectedDirection: currentDirection };
      }
    } catch {}

    return { advanced: false, newPage: beforeInfo.currentPage, detectedDirection: currentDirection };
  }

  /**
   * Backward-compatible simple turn page
   */
  async turnPage(page: Page, config: AppConfig, direction: 'rtl' | 'ltr' = 'rtl'): Promise<void> {
    if (config.mode === 'click' && config.clickSelector) {
      const btn = page.locator(config.clickSelector);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        return;
      }
    }

    const key = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.press(key);
  }

  async closeReader(page: Page): Promise<boolean> {
    try {
      if (page.isClosed()) return true;

      const closeBtn = page.locator(SELECTORS.READER_CLOSE_BUTTON).first();
      if (await closeBtn.isVisible({ timeout: 2500 })) {
        logger.info('[READER] Clicking Close to return to gallery...');
        await sleep(uglyRandom(800, 1600));

        const closePromise = page.waitForEvent('close', { timeout: 4000 }).catch(() => null);
        await closeBtn.click();
        await closePromise;

        if (!page.isClosed()) {
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await sleep(uglyRandom(1200, 2000));
          // Handle exit ad if YupManga displays an interstitial countdown upon closing the reader!
          await this.handleAdIfPresent(page, 'Exiting reader');
        }

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

    const speed = config.readingSpeed || 'normal';
    const profile = SPEED_PROFILES[speed] || SPEED_PROFILES.normal;

    logger.info(
      `[READER] Starting reading block: target ${targetPagesCount} pages (Speed: ${profile.icon} ${profile.name} [${profile.badge}])...`
    );

    // Initial check: ensure reader is actually loaded
    let initialInfo = await this.getPageInfo(page);
    if (!initialInfo) {
      logger.info('[READER] Waiting for reader page elements to load...');
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(1500);

        // Double check: if continue button is still visible, click it
        const continueBtn = page.locator(SELECTORS.AD_CONTINUE_BUTTON).first();
        if (await continueBtn.isVisible().catch(() => false)) {
          logger.info('[READER] Re-clicking continue button to ensure entry...');
          await page.evaluate(() => {
            const btn =
              document.getElementById('continueBtn') ||
              document.getElementById('continueBtnMobileTop') ||
              (document.querySelector('.continue-button') as HTMLElement | null) ||
              document.getElementById('btn-continue') ||
              (Array.from(document.querySelectorAll('button, a')).find((el) =>
                el.textContent?.includes('Continuar')
              ) as HTMLElement | null);
            if (btn) {
              btn.click();
              const inner = btn.querySelector('button');
              if (inner) inner.click();
            }
          }).catch(() => {});
          await continueBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(2000);
          await page.waitForLoadState('domcontentloaded').catch(() => {});
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

    // Resolve initial reading direction (default to RTL for manga, which maps forward to ArrowLeft)
    let activeDirection: 'rtl' | 'ltr' =
      config.readingDirection === 'rtl'
        ? 'rtl'
        : config.readingDirection === 'ltr'
          ? 'ltr'
          : (await this.detectDomReadingDirection(page)) || 'rtl';

    logger.info(`[READER] Initial reading orientation: [${activeDirection.toUpperCase()}]`);

    let consecutiveStuckCount = 0;
    const MAX_STUCK_RETRIES = 4;

    while (pagesRead < targetPagesCount) {
      if (signal?.aborted) break;

      const info = await this.getPageInfo(page);
      if (!info) {
        logger.warn('[READER] Lost reader page info. Re-checking...');
        await sleep(1500, signal);
        continue;
      }

      lastInfo = info;

      if (info.currentPage >= info.totalPages) {
        logger.info('[READER] Final page of volume reached!');
        volumeCompleted = true;
        await this.closeReader(page);
        break;
      }

      // Periodic feedback: log on first page, every 5 pages, or final page
      if (pagesRead === 0 || pagesRead % 5 === 0) {
        logger.info(
          `[READER] Progress: Page ${info.currentPage} of ${info.totalPages} (Session: ${pagesRead}/${targetPagesCount} pages)`
        );
      }

      const timeMultiplier = getTimeMultiplier();
      const delayResult = calculatePageDelay(config.readingSpeed, timeMultiplier);

      if (delayResult.isMicroPause) {
        logger.debug(
          `[READER] Human micro-pause active (+${delayResult.extraPauseSeconds}s). Reading page for ${delayResult.delaySeconds}s...`
        );
      }

      await sleep(delayResult.delayMs, signal);
      if (signal?.aborted) break;

      const turnResult = await this.turnPageForward(page, config, activeDirection);
      activeDirection = turnResult.detectedDirection;

      if (turnResult.advanced && turnResult.newPage > info.currentPage) {
        pagesRead++;
        consecutiveStuckCount = 0;
        lastInfo = { ...info, currentPage: turnResult.newPage };

        if (turnResult.newPage >= info.totalPages) {
          logger.info(
            `[READER] Progress: Page ${turnResult.newPage} of ${info.totalPages} (Session: ${pagesRead}/${targetPagesCount} pages)`
          );
          logger.info('[READER] Final page of volume reached!');
          volumeCompleted = true;
          await this.closeReader(page);
          break;
        }
      } else {
        consecutiveStuckCount++;
        logger.warn(
          `[READER] Page did not advance from Page ${info.currentPage} of ${info.totalPages} (Attempt ${consecutiveStuckCount}/${MAX_STUCK_RETRIES}).`
        );

        if (consecutiveStuckCount >= MAX_STUCK_RETRIES) {
          logger.error(
            `[READER] Reader cannot advance from Page ${info.currentPage}. Halting reading session safely to avoid desync.`
          );
          break;
        }

        await sleep(1500, signal);
      }
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
