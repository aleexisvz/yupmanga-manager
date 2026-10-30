import type { Page } from 'playwright';
import { BrowserManager } from '../browser/BrowserManager.js';
import { GalleryNavigator } from '../navigator/GalleryNavigator.js';
import { ReaderAutomation } from '../reader/ReaderAutomation.js';
import { WebtoonReader } from '../reader/WebtoonReader.js';
import { BrowsingSimulator } from '../behavior/BrowsingSimulator.js';
import { ActionScheduler, type SessionContext } from '../behavior/ActionScheduler.js';
import { MangaQueue } from '../queue/MangaQueue.js';
import { ProgressTracker } from '../storage/ProgressTracker.js';
import type { AppConfig, MangaEntry } from '../config/types.js';
import { SELECTORS } from '../config/defaults.js';
import { logger } from '../logger.js';
import { SERIES_TYPE_LABELS } from '../utils/seriesType.js';
import { sleep, uglyRandom } from '../utils/delay.js';

export class SessionOrchestrator {
  private isRunning = false;
  private isStopping = false;
  private abortController: AbortController | null = null;
  private webtoon: WebtoonReader;
  private context: SessionContext = {
    pagesReadInCurrentSession: 0,
    sessionStartTime: Date.now(),
    lastAction: null,
    lastProfileVisitTimestamp: 0,
    lastCategoryVisitTimestamp: 0,
    lastBreakTimestamp: 0,
  };

  constructor(
    private browser: BrowserManager,
    private gallery: GalleryNavigator,
    private reader: ReaderAutomation,
    private browsing: BrowsingSimulator,
    private scheduler: ActionScheduler,
    private queue: MangaQueue,
    private tracker: ProgressTracker,
    private config: AppConfig
  ) {
    this.webtoon = new WebtoonReader(reader);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.abortController = new AbortController();
    this.context.sessionStartTime = Date.now();

    const page = await this.browser.launch(this.config);

    logger.info('[SESSION] Autonomous reading session started.');

    // 1. Verify account authentication status (with Cloudflare wait if challenged)
    const auth = await this.browser.checkAuth(page);
    if (auth.isLoggedIn) {
      logger.info(
        `[AUTH] Connected as user: [${auth.username}] (Streak: ${auth.streak || 'N/A'}, Read: ${auth.caps || 'N/A'} caps)`
      );
    } else {
      logger.warn('*******************************************************************');
      logger.warn('[WARNING] [AUTH] YOU ARE CURRENTLY NOT LOGGED IN!');
      logger.warn('[WARNING] [AUTH] Running in ANONYMOUS GUEST mode.');
      logger.warn('[WARNING] [AUTH] Reading progress will NOT be registered to your account!');
      logger.warn('[WARNING] [AUTH] Please run "Setup" to log in with your CrambleSeles account.');
      logger.warn('*******************************************************************');
    }

    try {
      while (this.isRunning) {
        // 2. Proactive Cloudflare check: wait for user to solve if present instead of closing
        if (await this.browser.isCloudflareBlocked(page)) {
          const resolved = await this.browser.waitForCloudflareResolve(page);
          if (!resolved) {
            logger.warn('[CLOUDFLARE] Challenge unresolved. Stopping session.');
            break;
          }
        }

        const currentManga = await this.queue.getNext();
        if (!currentManga) {
          logger.warn('[QUEUE] No more series remaining in the reading queue.');
          logger.info('[SESSION] Ending autonomous reading session and returning to main menu.');
          break;
        }

        const action = this.scheduler.getNextAction(this.context);
        logger.info(`[SCHEDULER] Next action scheduled: [${action.type}]`);

        await this.executeAction(page, action.type, action.pagesToRead || 45, currentManga);

        this.context.lastAction = action.type;
      }
    } catch (error: any) {
      const isExpectedShutdown =
        !this.isRunning ||
        this.isStopping ||
        this.abortController?.signal.aborted ||
        error?.message?.includes('aborted') ||
        error?.message?.includes('Sleep aborted') ||
        error?.message?.includes('Target page, context or browser has been closed') ||
        error?.message?.includes('Target closed') ||
        error?.message?.includes('browser has been closed') ||
        error?.name === 'TargetClosedError';

      if (isExpectedShutdown) {
        logger.info('[SESSION] Session terminated gracefully.');
      } else {
        logger.error({ error }, '[SESSION] Unexpected error during orchestration');
      }
    } finally {
      await this.stop();
    }
  }

  private async executeAction(
    page: Page,
    actionType: string,
    pagesToRead: number,
    currentManga: MangaEntry
  ): Promise<void> {
    const signal = this.abortController?.signal;

    switch (actionType) {
      case 'read_pages': {
        await this.ensureOnMangaOrReader(page, currentManga);

        if (await this.browser.isCloudflareBlocked(page)) {
          const resolved = await this.browser.waitForCloudflareResolve(page);
          if (!resolved) return;
        }

        if (!currentManga.type && (await this.gallery.isGalleryPage(page))) {
          const detected = await this.gallery.detectSeriesType(page);
          if (detected) {
            currentManga.type = detected;
            await this.queue.setType(currentManga.url, detected);
            logger.info(`[SERIES] Detected series type for "${currentManga.title}": ${SERIES_TYPE_LABELS[detected]}`);
          }
        }

        if (currentManga.type === 'novel') {
          logger.warn(`[SERIES] "${currentManga.title}" is a novel, which is not supported yet. Pausing it in the queue.`);
          await this.queue.updateProgress(currentManga.url, {}, 'paused');
          break;
        }

        let activeReaderPage = page;

        // Check if there is already an open reader popup in the browser context
        const contextPages = page.context().pages();
        const existingModal = contextPages.find(
          (p) =>
            !p.isClosed() &&
            p !== page &&
            (p.url().includes('box-modal') ||
              p.url().includes('chapter') ||
              p.url().includes('reader') ||
              p.url().includes('interstitial'))
        );

        if (existingModal) {
          activeReaderPage = existingModal;
        } else if (await this.reader.isReaderPage(page)) {
          // The main page is already active inside the reader: continue reading directly
          activeReaderPage = page;
        } else {
          // Check if on gallery page, if so open next volume
          const isGallery = await this.gallery.isGalleryPage(page);
          if (isGallery) {
            await page.waitForSelector(SELECTORS.CHAPTER_LINK, { timeout: 6000 }).catch(() => {});
            const opened = await this.gallery.openNextVolume(page);
            if (!opened) {
              const hasNextPage = await this.gallery.hasNextGalleryPage(page);
              if (hasNextPage) {
                await this.gallery.goToNextGalleryPage(page);
                break;
              } else {
                const validation = await this.gallery.validateSeriesCompleted(page);
                if (validation.isComplete) {
                  await this.handleCompletedSeries(page, currentManga);
                } else {
                  logger.warn(`[GALLERY] No pending volumes found for "${currentManga.title}", but not all are verified completed.`);
                }
                break;
              }
            }
            activeReaderPage = opened.readerPage;
            await sleep(uglyRandom(2000, 4000));
          } else {
            logger.warn(`[READER] Not on catalog page for "${currentManga.title}". Navigating to catalog...`);
            await page.goto(currentManga.url, { waitUntil: 'domcontentloaded' });
            await sleep(uglyRandom(2000, 3500));
            break;
          }
        }

        // Verify reader is actually open before reading
        const inReader =
          activeReaderPage.url().includes('box-modal') ||
          activeReaderPage.url().includes('interstitial') ||
          (await this.reader.isReaderPage(activeReaderPage));

        if (!inReader) {
          logger.warn(`[READER] Reader not open for "${currentManga.title}". Retrying next cycle...`);
          break;
        }

        // Execute reading block on the active reader page
        // Manhwa chapters use the vertical webtoon reader; everything else pages horizontally
        const useWebtoon =
          currentManga.type === 'manhwa' || (await this.detectWebtoonReader(activeReaderPage, currentManga));
        const result = useWebtoon
          ? await this.webtoon.readPages(activeReaderPage, pagesToRead, this.config, signal)
          : await this.reader.readPages(activeReaderPage, pagesToRead, this.config, signal);

        this.context.pagesReadInCurrentSession += result.pagesRead;

        if (result.pagesRead > 0) {
          await this.tracker.recordSession(
            currentManga.url,
            currentManga.title,
            result.pagesRead,
            result.volumeCompleted,
            undefined,
            result.currentPage
          );

          await this.queue.updateProgress(currentManga.url, {
            lastPage: result.currentPage,
            totalPages: result.totalPages,
          });

          logger.info(`[STATS] Total pages read in this session: ${this.context.pagesReadInCurrentSession}`);
        }

        if (result.volumeCompleted) {
          logger.info(`[READER] Volume completed for series "${currentManga.title}". Checking for upcoming volumes...`);
          await sleep(uglyRandom(1500, 2500));

          if (await this.gallery.isGalleryPage(page)) {
            const nextCandidate = await this.gallery.findNextVolume(page);
            const hasNextPage = !nextCandidate && (await this.gallery.hasNextGalleryPage(page));

            if (nextCandidate) {
              logger.info(
                `[GALLERY] Next volume ahead found in series: "${nextCandidate.info.title}" [Status: ${nextCandidate.info.status}].`
              );
            } else if (hasNextPage) {
              logger.info('[GALLERY] Checking next catalog page for upcoming volumes...');
              await this.gallery.goToNextGalleryPage(page);
            } else {
              const validation = await this.gallery.validateSeriesCompleted(page);
              if (validation.isComplete) {
                await this.handleCompletedSeries(page, currentManga);
              }
            }
          }
        }
        break;
      }

      case 'visit_home':
        await this.closeAnyOpenReader(page);
        await this.browsing.visitHome(page);
        this.context.lastAction = 'visit_home';
        break;

      case 'visit_profile':
        await this.closeAnyOpenReader(page);
        await this.browsing.visitProfile(page);
        this.context.lastProfileVisitTimestamp = Date.now();
        break;

      case 'visit_categories':
        await this.closeAnyOpenReader(page);
        await this.browsing.visitCategories(page);
        this.context.lastCategoryVisitTimestamp = Date.now();
        break;

      case 'browse_manga':
        await this.closeAnyOpenReader(page);
        await this.browsing.browseManga(page);
        break;

      case 'scroll_around':
        await this.closeAnyOpenReader(page);
        await this.browsing.scrollAround(page);
        break;

      case 'short_break':
        await this.browsing.takeShortBreak(this.config, signal);
        this.context.lastBreakTimestamp = Date.now();
        break;

      case 'long_break':
        await this.closeAnyOpenReader(page);
        await this.browsing.takeLongBreak(page, this.config, signal);
        this.context.lastBreakTimestamp = Date.now();
        break;
    }
  }

  /**
   * Asks the site reader whether it runs in webtoon mode. The entry ad (box-modal) has no
   * reader yet, so it is passed first and the reader gets a few seconds to boot.
   * A positive answer is stored so the series is treated as a manhwa from now on.
   */
  private async detectWebtoonReader(readerPage: Page, manga: MangaEntry): Promise<boolean> {
    await this.reader.handlePreReaderAd(readerPage);

    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await this.webtoon.getState(readerPage);
      if (state) {
        if (state.isWebtoon && !manga.type) {
          manga.type = 'manhwa';
          await this.queue.setType(manga.url, 'manhwa');
          logger.info(`[SERIES] Webtoon reader detected for "${manga.title}". Saved series type: Manhwa`);
        }
        return state.isWebtoon;
      }
      await sleep(1500);
    }
    return false;
  }

  private async closeAnyOpenReader(page: Page): Promise<void> {
    try {
      if (page.isClosed()) return;

      const contextPages = page.context().pages();
      for (const p of contextPages) {
        if (
          !p.isClosed() &&
          (p.url().includes('box-modal') ||
            p.url().includes('chapter') ||
            p.url().includes('reader') ||
            (await this.reader.isReaderPage(p)))
        ) {
          logger.info('[READER] Closing open reader to return to catalog for browsing...');
          await this.reader.closeReader(p);

          // If it was a popup window separate from the main page, close it if still open
          if (p !== page && !p.isClosed()) {
            await p.close().catch(() => {});
          }
        }
      }

      // If the main page was used as the reader and close button failed to navigate away:
      if (!page.isClosed() && (await this.reader.isReaderPage(page))) {
        logger.info('[READER] Navigating main page back from reader to catalog...');
        await page.goBack().catch(() => {});
      }

      if (!page.isClosed()) {
        await page.bringToFront().catch(() => {});
      }
    } catch (err) {
      logger.debug({ err }, '[READER] Error while ensuring reader closed');
    }
  }

  private async ensureOnMangaOrReader(page: Page, manga: MangaEntry): Promise<void> {
    const inReader = await this.reader.isReaderPage(page);
    if (inReader) {
      return;
    }

    // Also check if any open popup window in context is in reader or ad modal
    const contextPages = page.context().pages();
    for (const p of contextPages) {
      if (!p.isClosed() && p !== page) {
        if (p.url().includes('box-modal') || (await this.reader.isReaderPage(p))) {
          return;
        }
      }
    }

    const currentUrl = page.url();
    let isMangaUrl = false;
    try {
      const current = new URL(currentUrl);
      const target = new URL(manga.url.startsWith('http') ? manga.url : `https://${manga.url}`);
      const currentPath = current.pathname.replace(/\/$/, '').toLowerCase();
      const targetPath = target.pathname.replace(/\/$/, '').toLowerCase();
      isMangaUrl = current.origin === target.origin && currentPath === targetPath;

      // Also check query param ID or slug matching (e.g. ?id=WRD73EIF9XJBY or /series/WRD73EIF9XJBY)
      const targetIdMatch = manga.url.match(/id=([^&]+)/i) || manga.url.match(/(?:series|manga)\/([^/?#]+)/i);
      const targetId = targetIdMatch?.[1]?.toLowerCase();
      if (targetId && currentUrl.toLowerCase().includes(targetId)) {
        isMangaUrl = true;
      }
    } catch {
      isMangaUrl = false;
    }

    if (!isMangaUrl) {
      logger.info(`[NAV] Navigating to manga catalog: ${manga.title}...`);
      await page.goto(manga.url, { waitUntil: 'domcontentloaded' });
      await sleep(uglyRandom(2000, 3500));
    }
  }

  private async handleCompletedSeries(page: Page, currentManga: MangaEntry): Promise<boolean> {
    logger.info(`[SERIES] All volumes for "${currentManga.title}" are completed! Series 100% read.`);
    await this.queue.remove(currentManga.url);
    logger.info(`[QUEUE] Automatically removed completed series from queue: "${currentManga.title}".`);

    const nextManga = await this.queue.getNext();
    if (nextManga) {
      logger.info(
        `[QUEUE] Next series ahead in queue found: "${nextManga.title}" (${nextManga.url}). Starting next series...`
      );
      await page.goto(nextManga.url, { waitUntil: 'domcontentloaded' });
      await sleep(uglyRandom(2000, 3500));
      return true;
    } else {
      logger.warn('[QUEUE] No more series remaining in the reading queue.');
      logger.info('[SESSION] Ending autonomous reading session and returning to main menu.');
      this.isRunning = false;
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    this.isRunning = false;
    this.abortController?.abort();
    await this.browser.close();
    logger.info('[SESSION] Reading session stopped and browser closed.');
  }
}
