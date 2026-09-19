import type { Page } from 'playwright';
import { BASE_URL, SELECTORS } from '../config/defaults.js';
import type { AppConfig } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom } from '../utils/delay.js';
import { HumanInput } from './HumanInput.js';

export class BrowsingSimulator {
  constructor(private humanInput: HumanInput) {}

  /**
   * Visita la página de inicio, scrollea las "Últimas series" y mira portadas
   */
  async visitHome(page: Page): Promise<void> {
    logger.info('🏠 [Simulación] Navegando a la página de Inicio...');
    try {
      const homeLink = page.locator(SELECTORS.NAV_HOME).first();
      if (await homeLink.isVisible().catch(() => false)) {
        await this.humanInput.humanClick(page, homeLink);
      } else {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      }

      await sleep(uglyRandom(1500, 3000));
      // Scrollear mirando las portadas de novedades
      await this.humanInput.browseScroll(page, uglyRandom(12_000, 26_000));
    } catch (error) {
      logger.debug({ error }, 'Error en visitHome');
    }
  }

  /**
   * Visita el perfil de usuario, revisa estadísticas, racha de lectura y últimos leídos
   */
  async visitProfile(page: Page): Promise<void> {
    logger.info('👤 [Simulación] Revisando perfil de usuario, racha y estadísticas...');
    try {
      const profileLink = page.locator(SELECTORS.NAV_PROFILE_AVATAR).first();
      if (await profileLink.isVisible().catch(() => false)) {
        await this.humanInput.humanClick(page, profileLink);
        await page.waitForLoadState('domcontentloaded');
        await sleep(uglyRandom(1500, 2500));

        // Mirar estadísticas y racha
        await this.humanInput.smoothScroll(page, 'down', uglyRandom(300, 600));
        await sleep(uglyRandom(2500, 5000));

        // Mirar últimos capítulos
        await this.humanInput.smoothScroll(page, 'down', uglyRandom(200, 400));
        await sleep(uglyRandom(3000, 6000));
      }
    } catch (error) {
      logger.debug({ error }, 'Error en visitProfile');
    }
  }

  /**
   * Visita la sección de Categorías y explora demografías / géneros
   */
  async visitCategories(page: Page): Promise<void> {
    logger.info('📂 [Simulación] Explorando sección de Categorías y géneros...');
    try {
      const catLink = page.locator(SELECTORS.NAV_CATEGORIES).first();
      if (await catLink.isVisible().catch(() => false)) {
        await this.humanInput.humanClick(page, catLink);
        await page.waitForLoadState('domcontentloaded');
        await sleep(uglyRandom(1800, 3200));

        // Scrollear categorías (Shonen, Seinen, etc.)
        await this.humanInput.browseScroll(page, uglyRandom(14_000, 24_000));
      }
    } catch (error) {
      logger.debug({ error }, 'Error en visitCategories');
    }
  }

  /**
   * Entra a la ficha de un manga de muestra para curiosear su sinopsis y vuelve
   */
  async browseManga(page: Page): Promise<void> {
    logger.info('🔍 [Simulación] Curiosando la sinopsis de un manga aleatorio...');
    try {
      // Buscar enlaces de mangas en la portada
      const seriesCards = page.locator('a[href*="/series/"], a[href*="/manga/"]');
      const count = await seriesCards.count();

      if (count > 0) {
        const randomIndex = Math.floor(Math.random() * Math.min(count, 8));
        const card = seriesCards.nth(randomIndex);

        await card.scrollIntoViewIfNeeded();
        await sleep(uglyRandom(800, 1600));
        await this.humanInput.humanClick(page, card);
        await page.waitForLoadState('domcontentloaded');

        // Leer descripción / sinopsis
        await sleep(uglyRandom(3500, 7000));
        await this.humanInput.smoothScroll(page, 'down', uglyRandom(250, 500));
        await sleep(uglyRandom(2500, 4500));

        // Regresar
        await page.goBack().catch(() => {});
        await sleep(uglyRandom(1200, 2500));
      }
    } catch (error) {
      logger.debug({ error }, 'Error en browseManga');
    }
  }

  /**
   * Scrollea suavemente la página en la que se encuentre actualmente
   */
  async scrollAround(page: Page): Promise<void> {
    logger.info('🔄 [Simulación] Ojeando y scrolleando la página actual...');
    await this.humanInput.browseScroll(page, uglyRandom(9_000, 22_000));
  }

  /**
   * Pausa breve de descanso (30s a 2.5 min)
   */
  async takeShortBreak(config: AppConfig, signal?: AbortSignal): Promise<void> {
    const duration = uglyRandom(config.behavior.shortBreakMinMs, config.behavior.shortBreakMaxMs);
    const minutes = (duration / 60_000).toFixed(2);
    logger.info(`☕ [Descanso] Tomando un descanso corto de ${minutes} minutos...`);
    await sleep(duration, signal);
  }

  /**
   * Descanso más largo con ojeo de páginas y pausa (7 a 20 min)
   */
  async takeLongBreak(page: Page, config: AppConfig, signal?: AbortSignal): Promise<void> {
    const duration = uglyRandom(config.behavior.longBreakMinMs, config.behavior.longBreakMaxMs);
    const minutes = (duration / 60_000).toFixed(2);
    logger.info(`🛋️ [Descanso Largo] Pausa extendida de ${minutes} minutos...`);

    // Durante el break largo, primero mira el inicio o perfil
    if (Math.random() > 0.5) {
      await this.visitHome(page);
    } else {
      await this.visitProfile(page);
    }

    // Esperar el resto del tiempo de descanso
    await sleep(duration, signal);
  }
}
