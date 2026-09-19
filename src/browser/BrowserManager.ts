import fs from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { USER_DATA_DIR, BASE_URL } from '../config/defaults.js';
import type { AppConfig, RunMode } from '../config/types.js';
import { logger } from '../logger.js';

export class BrowserManager {
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  /**
   * Asegura que el directorio de datos de usuario exista
   */
  private async ensureDataDir(): Promise<void> {
    await fs.mkdir(USER_DATA_DIR, { recursive: true });
  }

  /**
   * Construye los argumentos de Chrome según el modo de ejecución
   */
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
      // Abre la ventana fuera de la pantalla visible para el usuario
      args.push('--window-position=-32000,-32000');
    }

    return args;
  }

  /**
   * Lanza el navegador persistente para uso del bot
   */
  async launch(config: AppConfig): Promise<Page> {
    await this.ensureDataDir();

    const isHeadless = config.runMode === 'headless';
    const args = this.buildLaunchArgs(config.runMode);

    logger.info(`🌐 Iniciando navegador en modo [${config.runMode}]...`);

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
      // Fallback si Google Chrome no está instalado en la ruta por defecto del sistema
      if (launchOptions.channel === 'chrome') {
        logger.warn('⚠️ Google Chrome no fue detectado en su ruta habitual. Usando Chromium integrado...');
        delete launchOptions.channel;
        this.context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
      } else {
        throw err;
      }
    }

    // Inyectar script para ocultar huellas de automatización antes de que cargue la página
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
   * Modo interactivo para login manual y resolución inicial de Cloudflare
   */
  async setup(): Promise<void> {
    await this.ensureDataDir();

    logger.info('🔑 Iniciando modo SETUP (ventana visible)...');
    logger.info('👉 Por favor:');
    logger.info('   1. Si aparece Cloudflare ("Verifica que eres humano"), haz clic para resolverlo.');
    logger.info('   2. Inicia sesión en tu cuenta de YupManga si lo deseas.');
    logger.info('   3. Cuando estés listo, simplemente cierra la ventana del navegador.');

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
        viewport: null, // Permite redimensionar libremente
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

    // Esperar hasta que el usuario cierre el navegador
    await new Promise<void>((resolve) => {
      context.on('close', () => {
        logger.info('✅ Ventana cerrada. Sesión y cookies guardadas con éxito en ~/.yupmanga/browser-data/');
        resolve();
      });
    });
  }

  /**
   * Detecta si la página actual tiene un challenge de Cloudflare activo
   */
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

  /**
   * Cierra el contexto de navegador y guarda el estado
   */
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
