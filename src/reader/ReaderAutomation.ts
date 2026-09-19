import type { Page } from 'playwright';
import { SELECTORS } from '../config/defaults.js';
import type { AppConfig, PageInfo } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, randomInterval, getTimeMultiplier, uglyRandom } from '../utils/delay.js';

export interface ReadingSessionResult {
  pagesRead: number;
  currentPage: number;
  totalPages: number;
  volumeCompleted: boolean;
}

export class ReaderAutomation {
  /**
   * Detecta y maneja el anuncio intermedio con cuenta regresiva ("Espera X segundos...")
   */
  async handlePreReaderAd(page: Page): Promise<void> {
    try {
      // Comprobar si está presente el modal de anuncio
      const adModal = page.locator(SELECTORS.AD_MODAL_CONTAINER);
      const isVisible = await adModal.isVisible({ timeout: 2500 }).catch(() => false);

      if (!isVisible) return;

      logger.info('⏳ Pantalla intermedia de espera detectada ("Un momento y podrás seguir leyendo")...');

      // Esperar a que la cuenta regresiva termine (hasta 15s)
      const continueBtn = page.locator(SELECTORS.AD_CONTINUE_BUTTON);

      // Esperar a que el botón de Continuar esté disponible y clickeable
      await continueBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
        logger.debug('Botón directo de continuar no apareció por selector estándar, esperando desaparición del contador...');
      });

      // Pausa humana breve tras terminar la cuenta atrás
      await sleep(uglyRandom(800, 1900));

      if (await continueBtn.isVisible().catch(() => false)) {
        logger.info('👉 Clickeando botón para continuar al lector...');
        await continueBtn.click();
      } else {
        // En caso de que el modal se cierre solo o cambie
        await adModal.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
      }

      await sleep(uglyRandom(1000, 2000));
    } catch (error) {
      logger.debug({ error }, 'Aviso durante el manejo de publicidad previa');
    }
  }

  /**
   * Extrae la información de la página actual ("Página X de Y")
   */
  async getPageInfo(page: Page): Promise<PageInfo | null> {
    try {
      const pageInfoLocator = page.locator(SELECTORS.READER_PAGE_INFO).first();
      const isVisible = await pageInfoLocator.isVisible({ timeout: 2000 }).catch(() => false);

      if (!isVisible) return null;

      const text = await pageInfoLocator.innerText();
      const match = text.match(/Página\s+(\d+)\s+de\s+(\d+)/i);

      if (match) {
        return {
          currentPage: parseInt(match[1], 10),
          totalPages: parseInt(match[2], 10),
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Verifica si se ha alcanzado la última página del tomo/capítulo
   */
  async isLastPage(page: Page): Promise<boolean> {
    const info = await this.getPageInfo(page);
    if (!info) return false;
    return info.currentPage >= info.totalPages;
  }

  /**
   * Avanza a la siguiente página mediante teclado real o click
   */
  async turnPage(page: Page, config: AppConfig): Promise<void> {
    if (config.mode === 'click' && config.clickSelector) {
      const btn = page.locator(config.clickSelector);
      if (await btn.isVisible()) {
        await btn.click();
        return;
      }
    }

    // Por defecto: flecha derecha real a nivel CDP
    await page.keyboard.press('ArrowRight');
  }

  /**
   * Cierra el lector y regresa a la galería
   */
  async closeReader(page: Page): Promise<boolean> {
    try {
      const closeBtn = page.locator(SELECTORS.READER_CLOSE_BUTTON).first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        logger.info('📕 Fin del volumen alcanzado. Clickeando "Cerrar" para volver a la galería...');
        await sleep(uglyRandom(700, 1500));
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
   * Ejecuta un bloque de lectura de N páginas continuas con ritmo orgánico
   */
  async readPages(
    page: Page,
    targetPagesCount: number,
    config: AppConfig,
    signal?: AbortSignal
  ): Promise<ReadingSessionResult> {
    // 1. Manejar anuncio intermedio si está presente
    await this.handlePreReaderAd(page);

    let pagesRead = 0;
    let volumeCompleted = false;
    let lastInfo: PageInfo = { currentPage: 1, totalPages: 1 };

    logger.info(`📖 Iniciando bloque de lectura (meta objetivo: ${targetPagesCount} páginas)...`);

    while (pagesRead < targetPagesCount) {
      if (signal?.aborted) break;

      const info = await this.getPageInfo(page);
      if (info) {
        lastInfo = info;
        logger.info(`📑 [Lector] Página ${info.currentPage} de ${info.totalPages}`);

        if (info.currentPage >= info.totalPages) {
          logger.info('🎉 ¡Última página del volumen alcanzada!');
          volumeCompleted = true;
          await this.closeReader(page);
          break;
        }
      }

      // Intervalo entre páginas con variación y multiplicador según la hora
      const timeMultiplier = getTimeMultiplier();
      const baseDelay = randomInterval(config.intervalMs, config.variationPercent);
      const delay = Math.round(baseDelay * timeMultiplier);

      await sleep(delay, signal);

      // Pasar página
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
