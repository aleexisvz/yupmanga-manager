import type { Page, Locator } from 'playwright';
import { SELECTORS } from '../config/defaults.js';
import type { VolumeInfo, VolumeStatus } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom } from '../utils/delay.js';

export class GalleryNavigator {
  /**
   * Determina si la página actual es una página de galería de manga/capítulos
   */
  async isGalleryPage(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (url.includes('series.php') || url.includes('/series/') || url.includes('/manga/')) {
        // Verificar que no sea el reader activo
        const pageIndicator = await page.locator(SELECTORS.READER_PAGE_INFO).count();
        if (pageIndicator === 0) return true;
      }

      const chapterCount = await page.locator(SELECTORS.CHAPTER_LINK).count();
      if (chapterCount > 0) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Obtiene el estado de un volumen analizando sus clases Tailwind, texto y estilo computado
   */
  async getVolumeStatus(volumeLocator: Locator): Promise<VolumeStatus> {
    try {
      return await volumeLocator.evaluate((el: HTMLElement) => {
        const badge = el.querySelector('[class*="absolute"][class*="top-0"][class*="left-0"]');
        if (!badge) return 'not-started';

        const cls = badge.className || '';

        // 1. Detección por clases Tailwind
        if (cls.includes('green')) return 'completed';
        if (cls.includes('orange') || cls.includes('amber')) return 'in-progress';

        // 2. Detección por ícono unicode de check
        const text = (badge.textContent || '').trim();
        if (text.includes('✓')) return 'completed';

        // 3. Fallback: estilo computado
        const style = window.getComputedStyle(badge);
        const props = ['borderTopColor', 'borderLeftColor', 'backgroundColor', 'color'];

        for (const prop of props) {
          const color = (style as any)[prop];
          if (!color || color === 'transparent') continue;

          const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!match) continue;

          const r = parseInt(match[1], 10);
          const g = parseInt(match[2], 10);
          const b = parseInt(match[3], 10);

          if (r === 0 && g === 0 && b === 0) continue;

          // Verde: g dominante
          if (g > r * 1.3 && g > b * 1.3 && g >= 80) return 'completed';

          // Naranja: r dominante
          if (r >= 150 && r > g * 1.35 && b <= 50) return 'in-progress';
        }

        return 'not-started';
      });
    } catch {
      return 'unknown';
    }
  }

  /**
   * Lista todos los volúmenes visibles en la galería con sus estados y enlaces
   */
  async listAllVolumes(page: Page): Promise<VolumeInfo[]> {
    const locators = page.locator(SELECTORS.CHAPTER_LINK);
    const count = await locators.count();
    const result: VolumeInfo[] = [];

    for (let i = 0; i < count; i++) {
      const loc = locators.nth(i);
      const href = (await loc.getAttribute('href')) || '';
      const title = (await loc.innerText()).trim();
      const status = await this.getVolumeStatus(loc);

      result.push({
        href: href.startsWith('http') ? href : new URL(href, page.url()).toString(),
        title: title || `Capítulo ${i + 1}`,
        status,
      });
    }

    return result;
  }

  /**
   * Encuentra el siguiente volumen que debe leerse:
   * 1. Prioridad: 'in-progress'
   * 2. Prioridad: 'not-started' o 'unknown'
   */
  async findNextVolume(page: Page): Promise<{ locator: Locator; info: VolumeInfo } | null> {
    const locators = page.locator(SELECTORS.CHAPTER_LINK);
    const count = await locators.count();

    if (count === 0) return null;

    let inProgressCandidate: { locator: Locator; info: VolumeInfo } | null = null;
    let notStartedCandidate: { locator: Locator; info: VolumeInfo } | null = null;

    for (let i = 0; i < count; i++) {
      const loc = locators.nth(i);
      const href = (await loc.getAttribute('href')) || '';
      const title = (await loc.innerText()).trim();
      const status = await this.getVolumeStatus(loc);

      const info: VolumeInfo = {
        href: href.startsWith('http') ? href : new URL(href, page.url()).toString(),
        title: title || `Capítulo ${i + 1}`,
        status,
      };

      if (status === 'in-progress' && !inProgressCandidate) {
        inProgressCandidate = { locator: loc, info };
        break; // Tomamos el primer en progreso inmediatamente
      }

      if ((status === 'not-started' || status === 'unknown') && !notStartedCandidate) {
        notStartedCandidate = { locator: loc, info };
      }
    }

    return inProgressCandidate || notStartedCandidate;
  }

  /**
   * Abre el siguiente volumen pendiente haciendo click humanizado
   */
  async openNextVolume(page: Page): Promise<VolumeInfo | null> {
    const candidate = await this.findNextVolume(page);
    if (!candidate) {
      logger.info('📚 No se encontraron volúmenes pendientes en esta página de galería.');
      return null;
    }

    logger.info(`👉 Abriendo volumen: "${candidate.info.title}" [Estado: ${candidate.info.status}]...`);

    // Micro-pausa natural antes del click
    await sleep(uglyRandom(600, 1400));
    await candidate.locator.scrollIntoViewIfNeeded();
    await candidate.locator.click();

    return candidate.info;
  }

  /**
   * Comprueba si hay una página siguiente en la paginación de la galería
   */
  async hasNextGalleryPage(page: Page): Promise<boolean> {
    const nextButtons = page.locator('a, button').filter({
      hasText: /^(siguiente|next|›|»)$/i,
    });

    const count = await nextButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = nextButtons.nth(i);
      const isVisible = await btn.isVisible();
      const isEnabled = await btn.isEnabled();
      if (isVisible && isEnabled) return true;
    }

    return false;
  }

  /**
   * Navega a la siguiente página de la galería
   */
  async goToNextGalleryPage(page: Page): Promise<boolean> {
    const nextButtons = page.locator('a, button').filter({
      hasText: /^(siguiente|next|›|»)$/i,
    });

    const count = await nextButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = nextButtons.nth(i);
      if ((await btn.isVisible()) && (await btn.isEnabled())) {
        logger.info('📄 Navegando a la siguiente página del catálogo...');
        await sleep(uglyRandom(700, 1800));
        await btn.click();
        await page.waitForLoadState('domcontentloaded');
        return true;
      }
    }

    return false;
  }
}
