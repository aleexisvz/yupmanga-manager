import type { Page } from 'playwright';
import { BASE_URL, SELECTORS } from '../config/defaults.js';
import type { AppConfig } from '../config/types.js';
import { logger } from '../logger.js';
import { sleep, uglyRandom } from '../utils/delay.js';
import { HumanInput } from './HumanInput.js';

export class BrowsingSimulator {
  constructor(private humanInput: HumanInput) {}

  async visitHome(page: Page): Promise<void> {
    logger.info('[BROWSE] Browsing Home page...');
    try {
      const homeLink = page.locator(SELECTORS.NAV_HOME).first();
      if (await homeLink.isVisible().catch(() => false)) {
        await this.humanInput.humanClick(page, homeLink);
      } else {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      }

      await sleep(uglyRandom(1500, 3000));
      await this.humanInput.browseScroll(page, uglyRandom(12_000, 26_000));
    } catch (error) {
      logger.debug({ error }, '[BROWSE] Error in visitHome');
    }
  }

  async visitProfile(page: Page): Promise<void> {
    logger.info('[BROWSE] Visiting user profile, stats, and reading streak...');
    try {
      const profileLink = page.locator(SELECTORS.NAV_PROFILE_AVATAR).first();
      if (await profileLink.isVisible().catch(() => false)) {
        await this.humanInput.humanClick(page, profileLink);
        await page.waitForLoadState('domcontentloaded');
        await sleep(uglyRandom(1500, 2500));

        await this.humanInput.smoothScroll(page, 'down', uglyRandom(300, 600));
        await sleep(uglyRandom(2500, 5000));

        await this.humanInput.smoothScroll(page, 'down', uglyRandom(200, 400));
        await sleep(uglyRandom(3000, 6000));
      }
    } catch (error) {
      logger.debug({ error }, '[BROWSE] Error in visitProfile');
    }
  }

  async visitCategories(page: Page): Promise<void> {
    logger.info('[BROWSE] Exploring Categories and genres...');
    try {
      const catLink = page.locator(SELECTORS.NAV_CATEGORIES).first();
      if (await catLink.isVisible().catch(() => false)) {
        await this.humanInput.humanClick(page, catLink);
        await page.waitForLoadState('domcontentloaded');
        await sleep(uglyRandom(1800, 3200));

        await this.humanInput.browseScroll(page, uglyRandom(14_000, 24_000));
      }
    } catch (error) {
      logger.debug({ error }, '[BROWSE] Error in visitCategories');
    }
  }

  async browseManga(page: Page): Promise<void> {
    logger.info('[BROWSE] Inspecting a random manga synopsis...');
    try {
      const seriesCards = page.locator(SELECTORS.SERIES_CARDS);
      const count = await seriesCards.count();

      if (count > 0) {
        const randomIndex = Math.floor(Math.random() * Math.min(count, 8));
        const card = seriesCards.nth(randomIndex);

        await card.scrollIntoViewIfNeeded();
        await sleep(uglyRandom(800, 1600));
        await this.humanInput.humanClick(page, card);
        await page.waitForLoadState('domcontentloaded');

        await sleep(uglyRandom(3500, 7000));
        await this.humanInput.smoothScroll(page, 'down', uglyRandom(250, 500));
        await sleep(uglyRandom(2500, 4500));

        await page.goBack().catch(() => {});
        await sleep(uglyRandom(1200, 2500));
      }
    } catch (error) {
      logger.debug({ error }, '[BROWSE] Error in browseManga');
    }
  }

  async scrollAround(page: Page): Promise<void> {
    logger.info('[BROWSE] Lightly browsing and scrolling current page...');
    await this.humanInput.browseScroll(page, uglyRandom(9_000, 22_000));
  }

  async takeShortBreak(config: AppConfig, signal?: AbortSignal): Promise<void> {
    const duration = uglyRandom(config.behavior.shortBreakMinMs, config.behavior.shortBreakMaxMs);
    const minutes = (duration / 60_000).toFixed(2);
    logger.info(`[BREAK] Taking short break of ${minutes} minutes...`);
    await sleep(duration, signal);
  }

  async takeLongBreak(page: Page, config: AppConfig, signal?: AbortSignal): Promise<void> {
    const duration = uglyRandom(config.behavior.longBreakMinMs, config.behavior.longBreakMaxMs);
    const minutes = (duration / 60_000).toFixed(2);
    logger.info(`[BREAK] Extended break of ${minutes} minutes...`);

    if (Math.random() > 0.5) {
      await this.visitHome(page);
    } else {
      await this.visitProfile(page);
    }

    await sleep(duration, signal);
  }
}
