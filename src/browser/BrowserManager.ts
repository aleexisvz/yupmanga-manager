import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { USER_DATA_DIR, BASE_URL, SELECTORS } from '../config/defaults.js';
import type { AppConfig, RunMode } from '../config/types.js';
import { ConfigLoader } from '../config/loader.js';
import { setupGracefulShutdown } from '../utils/signals.js';
import { logger } from '../logger.js';
import { sleep } from '../utils/delay.js';
import { parseHeaderStreak, parseProfileStats } from '../utils/profileStats.js';

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

  buildLaunchArgs(mode: RunMode): string[] {
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--enable-webgl',
      '--use-gl=desktop',
      '--window-size=1280,850',
    ];

    if (mode === 'offscreen') {
      args.push('--window-position=-32000,-32000');
    } else if (mode === 'headed') {
      args.push('--window-position=50,50');
    }

    return args;
  }


  private async releaseBrowserLock(): Promise<void> {
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const ps = spawn('powershell.exe', [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $_.CommandLine -like '*yupmanga*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ]);
        ps.on('close', () => resolve());
        ps.on('error', () => resolve());
      });
    }

    const lockFiles = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const f of lockFiles) {
      await fs.unlink(path.join(USER_DATA_DIR, f)).catch(() => {});
    }
  }

  private async launchPersistentWithRetry(
    options: Parameters<typeof chromium.launchPersistentContext>[1],
    maxAttempts = 3
  ): Promise<BrowserContext> {
    const launchOptions = { ...options };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
      } catch (err: any) {
        const isLockError =
          err?.message?.includes('ProcessSingleton') ||
          err?.message?.includes('Lock file') ||
          err?.message?.includes('0x20');

        if (isLockError) {
          logger.warn(`[BROWSER] Profile directory locked (attempt ${attempt}/${maxAttempts}). Waiting and releasing resources...`);
          if (attempt === 1) {
            await sleep(2000);
          } else {
            await this.releaseBrowserLock();
            await sleep(1500);
          }
          continue;
        }

        if (launchOptions.channel === 'chrome') {
          logger.warn('[BROWSER] Chrome channel unavailable. Falling back to bundled Chromium...');
          delete launchOptions.channel;
          continue;
        }

        throw err;
      }
    }

    logger.warn('[BROWSER] Forcing release of profile lock for clean start...');
    await this.releaseBrowserLock();
    await sleep(2000);
    delete launchOptions.channel;
    return await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
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
      viewport: { width: 1280, height: 850 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    };

    if (config.antiDetection.useRealChrome) {
      launchOptions.channel = 'chrome';
    }

    if (config.proxy) {
      launchOptions.proxy = { server: config.proxy };
    }

    this.context = await this.launchPersistentWithRetry(launchOptions);

    // Mock document.hidden and visibilityState for YupManga reading timers without interfering with Cloudflare
    await this.context.addInitScript(() => {
      try {
        if (location.hostname && !location.hostname.includes('cloudflare')) {
          Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
          Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
          Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
          window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
          window.addEventListener('webkitvisibilitychange', (e) => e.stopImmediatePropagation(), true);
        }
      } catch {}
    });

    const pages = this.context.pages();
    const firstPage = pages[0];
    this.activePage = firstPage ?? (await this.context.newPage());

    return this.activePage;
  }

  async setup(mangaUrl?: string, options?: { autoSwitchMode?: boolean }): Promise<void> {
    const autoSwitch = options?.autoSwitchMode ?? true;
    let originalMode: RunMode | null = null;

    if (autoSwitch) {
      try {
        const config = await ConfigLoader.load();
        if (config.runMode !== 'headed') {
          originalMode = config.runMode;
          logger.info(
            `[SETUP] Temporarily switching browser mode from '${originalMode}' to 'headed' for account setup.`
          );
          config.runMode = 'headed';
          await ConfigLoader.save(config);
        }
      } catch (err) {
        logger.warn({ err }, '[SETUP] Could not read/update config for auto mode switch.');
      }
    }

    let isRestored = false;
    const restoreMode = async () => {
      if (isRestored || !originalMode) return;
      isRestored = true;
      try {
        const latestConfig = await ConfigLoader.load();
        latestConfig.runMode = originalMode;
        await ConfigLoader.save(latestConfig);
        logger.info(`[SETUP] Restored browser mode back to '${originalMode}'.`);
      } catch (err) {
        logger.error({ err }, '[SETUP] Failed to restore original browser mode.');
      }
    };

    const teardownSignals = setupGracefulShutdown(async () => {
      await restoreMode();
      if (this.context) {
        await this.context.close().catch(() => {});
      }
    });

    try {
      await this.ensureDataDir();

      logger.info('=====================================================');
      logger.info('[SETUP] Starting manual login setup (visible Chrome window)...');
      logger.info('[SETUP] Instructions:');
      logger.info('  1. If Cloudflare asks to verify you are human, click the checkbox.');
      logger.info('  2. Log in with your account ("CrambleSeles").');
      logger.info('  3. Once logged in and on the site, close this browser window.');
      logger.info('=====================================================');

      const args = [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,900',
        '--window-position=50,50',
      ];

      const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
        headless: false,
        channel: 'chrome',
        args,
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: null,
      };

      const context = await this.launchPersistentWithRetry(launchOptions);
      this.context = context;

      const pages = context.pages();
      const firstPage = pages[0];
      const page = firstPage ?? (await context.newPage());
      const targetUrl = mangaUrl || BASE_URL;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = async () => {
          if (resolved) return;
          resolved = true;
          logger.info('[SETUP] Browser window closed. Session and tokens saved to ~/.yupmanga/browser-data/');
          this.context = null;
          this.activePage = null;
          await sleep(1000);
          resolve();
        };

        context.on('close', done);
        page.on('close', async () => {
          await sleep(500);
          if (context.pages().filter((p) => !p.isClosed()).length === 0) {
            try {
              await context.close();
            } catch {}
            await done();
          }
        });
      });
    } finally {
      teardownSignals();
      await restoreMode();
    }
  }

  /**
   * Accurate check for Cloudflare challenge screen
   */
  async isCloudflareBlocked(page: Page): Promise<boolean> {
    try {
      const title = await page.title();
      if (
        title.includes('Attention Required') ||
        title.includes('Just a moment') ||
        title.includes('Atención requerida') ||
        title.includes('Cloudflare') ||
        title.includes('Blocked')
      ) {
        return true;
      }

      const hasTurnstile = await page
        .locator(SELECTORS.CLOUDFLARE_CHALLENGE)
        .count();
      if (hasTurnstile > 0) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Waits for user to solve Cloudflare challenge if visible, rather than aborting instantly
   */
  async waitForCloudflareResolve(page: Page, timeoutMs = 120_000): Promise<boolean> {
    if (!(await this.isCloudflareBlocked(page))) {
      return true;
    }

    logger.warn('================================================================');
    logger.warn('[CLOUDFLARE] Verification challenge detected!');
    logger.warn('[CLOUDFLARE] Please click the verification checkbox in the open Chrome window.');
    logger.warn('[CLOUDFLARE] Waiting up to 2 minutes for you to solve it...');
    logger.warn('================================================================');

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(1500);
      if (!(await this.isCloudflareBlocked(page))) {
        logger.info('[CLOUDFLARE] Verification passed! Resuming session...');
        await sleep(2000);
        return true;
      }
    }

    logger.error('[CLOUDFLARE] Verification timed out after 2 minutes.');
    return false;
  }

  private isGenericProfileText(text?: string | null): boolean {
    if (!text) return true;
    const clean = text.trim().toLowerCase();
    return ['perfil', 'profile', 'mi perfil', 'my profile', 'usuario', 'cuenta', 'logged-in user'].includes(clean);
  }

  async checkAuth(page: Page): Promise<AuthStatus> {
    try {
      logger.info('[AUTH] Checking account authentication status on YupManga...');
      await page.goto('https://www.yupmanga.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      // Handle Cloudflare if challenged on home
      if (await this.isCloudflareBlocked(page)) {
        const resolved = await this.waitForCloudflareResolve(page);
        if (!resolved) {
          return { isLoggedIn: false };
        }
      }

      // Check if logged in directly from home page header or DOM
      const homeAuth = await page.evaluate(
        (sel) => {
          const profileLink = document.querySelector(sel.PROFILE_LINKS);
          const loginLink = document.querySelector(sel.LOGIN_LINKS);
          const isDataLoggedIn = document.body.getAttribute('data-logged-in') === 'true';
          const hasStreakTopline = !!document.querySelector(sel.HEADER_STREAK_TOPLINE);

          // Extract username from header if present
          const headerUserEl = document.querySelector(sel.HEADER_USER);
          const rawHeaderUsername = headerUserEl ? headerUserEl.textContent?.trim() : null;

          // Header streak badge: title "Racha actual: 70 días. Récord: 70 días.", text "70"
          const headerStreakEl = document.querySelector(sel.HEADER_STREAK_COUNT);
          const headerStreakTitle = headerStreakEl?.getAttribute('title') || '';
          const headerStreakText = headerStreakEl?.textContent?.trim() || '';

        const isLoggedIn = isDataLoggedIn || hasStreakTopline || (!!profileLink && !loginLink);

        return {
          isLoggedIn,
          hasLogin: !!loginLink,
          headerUsername: rawHeaderUsername,
          headerStreakTitle,
          headerStreakText,
        };
      }, {
        PROFILE_LINKS: SELECTORS.PROFILE_LINKS,
        LOGIN_LINKS: SELECTORS.LOGIN_LINKS,
        HEADER_STREAK_TOPLINE: SELECTORS.HEADER_STREAK_TOPLINE,
        HEADER_USER: SELECTORS.HEADER_USER,
        HEADER_STREAK_COUNT: SELECTORS.HEADER_STREAK_COUNT,
      });

      if (!homeAuth.isLoggedIn) {
        return { isLoggedIn: false };
      }

      let username = !this.isGenericProfileText(homeAuth.headerUsername) ? homeAuth.headerUsername! : '';
      // The header badge is the authoritative streak; /perfil is only a fallback
      const headerStreak =
        parseHeaderStreak(homeAuth.headerStreakTitle) || homeAuth.headerStreakText.match(/^\d+$/)?.[0] || '';
      let streak = headerStreak ? `${headerStreak} dias` : '';
      let caps = '';
      let series = '';

      // Safely try to read stats and confirmed username from /perfil
      try {
        await page.goto('https://www.yupmanga.com/perfil', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        if (await this.isCloudflareBlocked(page)) {
          await this.waitForCloudflareResolve(page);
        }

        if (!(await this.isCloudflareBlocked(page))) {
          const profilePage = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            // Extract username from h1 or profile heading
            const h1El = document.querySelector('h1');
            let profileUser = h1El?.textContent?.trim() || '';

            if (!profileUser) {
              const statsMatch = bodyText.match(/Estadísticas de\s+([^\n\r]+)/i);
              if (statsMatch?.[1]) profileUser = statsMatch[1].trim();
            }

            return { profileUser, bodyText };
          });

          if (profilePage.profileUser && !this.isGenericProfileText(profilePage.profileUser)) {
            username = profilePage.profileUser;
          }
          const profileStats = parseProfileStats(profilePage.bodyText);
          if (!streak && profileStats.streak) streak = `${profileStats.streak} dias`;
          if (profileStats.caps) caps = profileStats.caps;
          if (profileStats.series) series = profileStats.series;
        }
      } catch (err) {
        logger.debug({ err }, '[AUTH] Could not fetch details from /perfil');
      }

      return {
        isLoggedIn: true,
        username: username || 'Usuario Conectado',
        streak,
        caps,
        series,
      };
    } catch (error) {
      logger.debug({ error }, '[AUTH] Error checking authentication');
      return { isLoggedIn: false };
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.activePage = null;
      await sleep(1000);
    }
  }

  getPage(): Page | null {
    return this.activePage;
  }
}
