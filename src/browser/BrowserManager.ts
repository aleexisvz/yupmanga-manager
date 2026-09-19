import fs from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { USER_DATA_DIR, BASE_URL } from '../config/defaults.js';
import type { AppConfig, RunMode } from '../config/types.js';
import { logger } from '../logger.js';

export interface AuthStatus {
  isLoggedIn: boolean;
  username?: string;
  streak?: string;
  caps?: string;
  series?: string;
}

export class BrowserManager {
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  private async ensureDataDir(): Promise<void> {
    await fs.mkdir(USER_DATA_DIR, { recursive: true });
  }

  private buildLaunchArgs(mode: RunMode): string[] {
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      '--enable-webgl',
      '--use-gl=desktop',
      '--window-size=1920,1080',
    ];

    if (mode === 'offscreen') {
      args.push('--window-position=-32000,-32000');
    }

    return args;
  }

  async launch(config: AppConfig): Promise<Page> {
    await this.ensureDataDir();

    const isHeadless = config.runMode === 'headless';
    const args = this.buildLaunchArgs(config.runMode);

    logger.info(`[BROWSER] Launching Chrome in [${config.runMode}] mode...`);

    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: isHeadless,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    };

    if (config.antiDetection.useRealChrome) {
      launchOptions.channel = 'chrome';
    }

    if (config.proxy) {
      launchOptions.proxy = { server: config.proxy };
    }

    try {
      this.context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
    } catch (err: any) {
      if (launchOptions.channel === 'chrome') {
        logger.warn('[BROWSER] Chrome channel unavailable. Falling back to bundled Chromium...');
        delete launchOptions.channel;
        this.context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
      } else {
        throw err;
      }
    }

    if (config.antiDetection.removeWebdriverFlag) {
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      });
    }

    const pages = this.context.pages();
    this.activePage = pages.length > 0 ? pages[0] : await this.context.newPage();

    return this.activePage;
  }

  /**
   * Interactive setup mode for manual login and Cloudflare challenge resolution
   */
  async setup(): Promise<void> {
    await this.ensureDataDir();

    logger.info('=====================================================');
    logger.info('[SETUP] Starting manual login setup (visible Chrome)...');
    logger.info('[SETUP] Instructions:');
    logger.info('  1. If Cloudflare asks to verify you are human, click the checkbox.');
    logger.info('  2. Log in with your account ("CrambleSeles").');
    logger.info('  3. Once logged in and on the site, simply close this browser window.');
    logger.info('=====================================================');

    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,900',
    ];

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        channel: 'chrome',
        args,
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: null,
      });
    } catch {
      context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        args,
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: null,
      });
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await new Promise<void>((resolve) => {
      context.on('close', () => {
        logger.info('[SETUP] Browser window closed. Session saved to ~/.yupmanga/browser-data/');
        resolve();
      });
    });
  }

  /**
   * Checks whether the current session is logged in and extracts user details
   */
  async checkAuth(page: Page): Promise<AuthStatus> {
    try {
      logger.info('[AUTH] Checking account authentication status on YupManga...');
      await page.goto('https://yupmanga.com/perfil', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const url = page.url();
      const content = await page.content();

      // Check if redirected to login or if login text is present
      const isLoginPage = url.includes('login') || url.includes('ingresar') || content.includes('Iniciar Sesión');

      if (isLoginPage) {
        return { isLoggedIn: false };
      }

      // Extract username and stats from profile page
      const profileData = await page.evaluate(() => {
        // Look for username heading or avatar label
        const bodyText = document.body.innerText;
        
        // Find username in profile (e.g. "CrambleSeles")
        let username = '';
        const nameEl = document.querySelector('h1, h2, h3, [class*="username"], [class*="profile-name"]');
        if (nameEl && nameEl.textContent) {
          username = nameEl.textContent.trim().split('\n')[0].trim();
        }

        // Search for stats in text
        let streak = '';
        const streakMatch = bodyText.match(/(\d+)\s*d[ií]as\s*Racha\s*actual/i) || bodyText.match(/Racha.*?(\d+)\s*d[ií]as/i);
        if (streakMatch) streak = `${streakMatch[1]} dias`;

        let caps = '';
        const capsMatch = bodyText.match(/(\d+)\s*Caps/i);
        if (capsMatch) caps = capsMatch[1];

        let series = '';
        const seriesMatch = bodyText.match(/(\d+)\s*Series/i);
        if (seriesMatch) series = seriesMatch[1];

        return {
          username: username || 'Logged-In User',
          streak,
          caps,
          series,
        };
      });

      return {
        isLoggedIn: true,
        username: profileData.username,
        streak: profileData.streak,
        caps: profileData.caps,
        series: profileData.series,
      };
    } catch (error) {
      logger.debug({ error }, '[AUTH] Error checking authentication');
      return { isLoggedIn: false };
    }
  }

  async isCloudflareBlocked(page: Page): Promise<boolean> {
    try {
      const title = await page.title();
      const content = await page.content();

      const isChallengeTitle = title.includes('Just a moment') || title.includes('Atención requerida');
      const hasCloudflareMarkers =
        content.includes('cf-challenge') ||
        content.includes('cf-turnstile') ||
        content.includes('challenge-platform') ||
        content.includes('Verifica que eres humano');

      return isChallengeTitle || hasCloudflareMarkers;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.activePage = null;
    }
  }

  getPage(): Page | null {
    return this.activePage;
  }
}
