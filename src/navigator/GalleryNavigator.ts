import type { Page, Locator } from 'playwright';
import { SELECTORS } from '../config/defaults.js';
import type { VolumeInfo, VolumeStatus } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom } from '../utils/delay.js';

export interface OpenedVolumeResult {
  info: VolumeInfo;
  readerPage: Page;
}

export class GalleryNavigator {
  async isGalleryPage(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (url.includes('series.php') || url.includes('/series/') || url.includes('/manga/')) {
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

  async getVolumeStatus(volumeLocator: Locator): Promise<VolumeStatus> {
    try {
      return await volumeLocator.evaluate((el: HTMLElement) => {
        const badge = el.querySelector('[class*="absolute"][class*="top-0"][class*="left-0"]');
        if (!badge) return 'not-started';

        const cls = badge.className || '';

        if (cls.includes('green')) return 'completed';
        if (cls.includes('orange') || cls.includes('amber')) return 'in-progress';

        const text = (badge.textContent || '').trim();
        if (text.includes('✓')) return 'completed';

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

          if (g > r * 1.3 && g > b * 1.3 && g >= 80) return 'completed';
          if (r >= 150 && r > g * 1.35 && b <= 50) return 'in-progress';
        }

        return 'not-started';
      });
    } catch {
      return 'unknown';
    }
  }

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
        title: title || `Chapter ${i + 1}`,
        status,
      });
    }

    return result;
  }

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
        title: title || `Chapter ${i + 1}`,
        status,
      };

      if (status === 'in-progress' && !inProgressCandidate) {
        inProgressCandidate = { locator: loc, info };
        break;
      }

      if ((status === 'not-started' || status === 'unknown') && !notStartedCandidate) {
        notStartedCandidate = { locator: loc, info };
      }
    }

    return inProgressCandidate || notStartedCandidate;
  }

  async openNextVolume(page: Page): Promise<OpenedVolumeResult | null> {
    const candidate = await this.findNextVolume(page);
    if (!candidate) {
      logger.info('[GALLERY] No pending volumes found on this catalog page.');
      return null;
    }

    logger.info(`[GALLERY] Opening volume: "${candidate.info.title}" [Status: ${candidate.info.status}]...`);

    await sleep(uglyRandom(600, 1400));
    await candidate.locator.scrollIntoViewIfNeeded();

    const context = page.context();
    const [popupPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 8000 }).catch(() => null),
      candidate.locator.click(),
    ]);

    let readerPage = popupPage;

    if (readerPage) {
      logger.info('[GALLERY] Reader popup window detected. Switching active context to reader modal...');
      await readerPage.waitForLoadState('domcontentloaded').catch(() => {});
    } else {
      // Fallback: check if any other page exists in the context
      const pages = context.pages();
      const otherPage = pages.find((p) => p !== page && !p.isClosed());
      if (otherPage) {
        logger.info('[GALLERY] Found open reader modal window in context.');
        await otherPage.waitForLoadState('domcontentloaded').catch(() => {});
        readerPage = otherPage;
      } else {
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        readerPage = page;
      }
    }

    return {
      info: candidate.info,
      readerPage,
    };
  }

  async hasNextGalleryPage(page: Page): Promise<boolean> {
    const nextButtons = page.locator(SELECTORS.PAGINATION_BUTTONS).filter({
      hasText: SELECTORS.PAGINATION_NEXT_REGEX,
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

  async goToNextGalleryPage(page: Page): Promise<boolean> {
    const nextButtons = page.locator(SELECTORS.PAGINATION_BUTTONS).filter({
      hasText: SELECTORS.PAGINATION_NEXT_REGEX,
    });

    const count = await nextButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = nextButtons.nth(i);
      if ((await btn.isVisible()) && (await btn.isEnabled())) {
        logger.info('[GALLERY] Navigating to next catalog page...');
        await sleep(uglyRandom(700, 1800));
        await btn.click();
        await page.waitForLoadState('domcontentloaded');
        return true;
      }
    }

    return false;
  }
}
