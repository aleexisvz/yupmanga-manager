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

  /**
   * Inicia la sesión de lectura autónoma
   */
  async start(): Promise<void> {
    this.isRunning = true;
    this.abortController = new AbortController();
    this.context.sessionStartTime = Date.now();

    const page = await this.browser.launch(this.config);

    logger.info('🚀 Sesión autónoma de YupManga Manager iniciada.');

    try {
      while (this.isRunning) {
        // 1. Detección de Cloudflare
        if (await this.browser.isCloudflareBlocked(page)) {
          logger.warn('🛡️ Cloudflare challenge detectado. Pausando para no emitir señales de bot...');
          logger.warn('👉 Por favor ejecuta "npm run dev -- setup" para renovar la verificación manual.');
          break;
        }

        // 2. Obtener el manga actual de la cola
        const currentManga = await this.queue.getNext();
        if (!currentManga) {
          logger.warn('📋 La cola de mangas está vacía o todos los mangas están completados.');
          logger.info('💡 Agrega mangas a la cola usando el menú interactivo.');
          break;
        }

        // 3. Consultar al ActionScheduler qué acción tomar
        const action = this.scheduler.getNextAction(this.context);
        logger.info(`🎲 Acción programada: [${action.type}]`);

        // 4. Ejecutar la acción correspondiente
        await this.executeAction(page, action.type, action.pagesToRead || 15, currentManga);

        // 5. Actualizar contexto
        this.context.lastAction = action.type;
      }
    } catch (error: any) {
      if (error?.message?.includes('aborted')) {
        logger.info('Sesión interrumpida limpiamente.');
      } else {
        logger.error({ error }, 'Error inesperado durante la orquestación');
      }
    } finally {
      await this.stop();
    }
  }

  /**
   * Ejecuta una acción puntual determinada por el scheduler
   */
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

        // Si estamos en la galería, abrir siguiente volumen
        const isGallery = await this.gallery.isGalleryPage(page);
        if (isGallery) {
          const opened = await this.gallery.openNextVolume(page);
          if (!opened) {
            // Verificar si hay más páginas en el catálogo
            const hasNextPage = await this.gallery.hasNextGalleryPage(page);
            if (hasNextPage) {
              await this.gallery.goToNextGalleryPage(page);
              break;
            } else {
              logger.info(`🏆 ¡Manga "${currentManga.title}" completado al 100%!`);
              await this.queue.updateProgress(currentManga.url, {}, 'completed');
              break;
            }
          }
          await sleep(uglyRandom(1500, 3000));
        }

        // Ejecutar bloque de lectura de páginas
        const result = await this.reader.readPages(page, pagesToRead, this.config, signal);

        this.context.pagesReadInCurrentSession += result.pagesRead;

        // Guardar progreso en disco
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

        logger.info(`📊 Páginas leídas en esta sesión: ${this.context.pagesReadInCurrentSession}`);
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

  /**
   * Asegura que el navegador esté en la URL del manga actual o dentro de su reader
   */
  private async ensureOnMangaOrReader(page: Page, manga: MangaEntry): Promise<void> {
    const currentUrl = page.url();
    const isMangaUrl = currentUrl.includes(manga.url) || manga.url.includes(currentUrl);
    const inReader = (await page.locator('text=/Página\\s+\\d+\\s+de\\s+\\d+/i').count()) > 0;

    if (!isMangaUrl && !inReader) {
      logger.info(`🧭 Navegando a la galería del manga: ${manga.title}...`);
      await page.goto(manga.url, { waitUntil: 'domcontentloaded' });
      await sleep(uglyRandom(1500, 3000));
    }
  }

  /**
   * Detiene la sesión ordenadamente
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.abortController?.abort();
    await this.browser.close();
    logger.info('⏹️ Sesión de lectura detenida y navegador cerrado.');
  }
}
