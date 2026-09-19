import type { Page } from 'playwright';
import { BrowserManager } from '../browser/BrowserManager.js';
import { GalleryNavigator } from '../navigator/GalleryNavigator.js';
import { ReaderAutomation } from '../reader/ReaderAutomation.js';
import { BrowsingSimulator } from '../behavior/BrowsingSimulator.js';
import { ActionScheduler, type SessionContext } from '../behavior/ActionScheduler.js';
import { MangaQueue } from '../queue/MangaQueue.js';
import { ProgressTracker } from '../storage/ProgressTracker.js';
import type { AppConfig, MangaEntry } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom } from '../utils/delay.js';

export class SessionOrchestrator {
  private isRunning = false;
  private abortController: AbortController | null = null;
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
  ) {}

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
          logger.warn('[QUEUE] The manga queue is empty or all entries are marked as completed.');
          logger.info('[QUEUE] Add a series via the interactive CLI menu.');
          break;
        }

        const action = this.scheduler.getNextAction(this.context);
        logger.info(`[SCHEDULER] Next action scheduled: [${action.type}]`);

        await this.executeAction(page, action.type, action.pagesToRead || 45, currentManga);

        this.context.lastAction = action.type;
      }
    } catch (error: any) {
      if (error?.message?.includes('aborted')) {
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

        // Check if on gallery page, if so open next volume
        const isGallery = await this.gallery.isGalleryPage(page);
        if (isGallery) {
          const opened = await this.gallery.openNextVolume(page);
          if (!opened) {
            const hasNextPage = await this.gallery.hasNextGalleryPage(page);
            if (hasNextPage) {
              await this.gallery.goToNextGalleryPage(page);
              break;
            } else {
              logger.info(`[GALLERY] Manga "${currentManga.title}" 100% completed!`);
              await this.queue.updateProgress(currentManga.url, {}, 'completed');
              break;
            }
          }
          await sleep(uglyRandom(2000, 4000));
        }

        // Execute reading block
        const result = await this.reader.readPages(page, pagesToRead, this.config, signal);

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
        break;
      }

      case 'visit_home':
        await this.browsing.visitHome(page);
        this.context.lastAction = 'visit_home';
        break;

      case 'visit_profile':
        await this.browsing.visitProfile(page);
        this.context.lastProfileVisitTimestamp = Date.now();
        break;

      case 'visit_categories':
        await this.browsing.visitCategories(page);
        this.context.lastCategoryVisitTimestamp = Date.now();
        break;

      case 'browse_manga':
        await this.browsing.browseManga(page);
        break;

      case 'scroll_around':
        await this.browsing.scrollAround(page);
        break;

      case 'short_break':
        await this.browsing.takeShortBreak(this.config, signal);
        this.context.lastBreakTimestamp = Date.now();
        break;

      case 'long_break':
        await this.browsing.takeLongBreak(page, this.config, signal);
        this.context.lastBreakTimestamp = Date.now();
        break;
    }
  }

  private async ensureOnMangaOrReader(page: Page, manga: MangaEntry): Promise<void> {
    const inReader = await this.reader.isReaderPage(page);
    if (inReader) {
      return;
    }

    const currentUrl = page.url();
    const isMangaUrl = currentUrl.includes(manga.url) || manga.url.includes(currentUrl);

    if (!isMangaUrl) {
      logger.info(`[NAV] Navigating to manga catalog: ${manga.title}...`);
      await page.goto(manga.url, { waitUntil: 'domcontentloaded' });
      await sleep(uglyRandom(2000, 3500));
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.abortController?.abort();
    await this.browser.close();
    logger.info('[SESSION] Reading session stopped and browser closed.');
  }
}
