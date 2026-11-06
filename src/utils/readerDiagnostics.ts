import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Page } from 'playwright';
import { logger } from '../logger.js';

export const DEBUG_DIR = path.join(os.homedir(), '.yupmanga', 'debug');

/**
 * Saves a screenshot and a short text dump of the page when the reader cannot be detected,
 * so a site change can be diagnosed from what was actually on screen. Never throws.
 */
export async function captureReaderDiagnostics(page: Page, label: string): Promise<string | null> {
  try {
    if (page.isClosed()) return null;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `${stamp}-${label}`);
    await fs.mkdir(DEBUG_DIR, { recursive: true });

    const info = await page.evaluate(() => ({
      title: document.title,
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800),
      hasReaderContent: Boolean(document.querySelector('#readerContent')),
      pageImages: document.querySelectorAll('img.page-image').length,
      hasReaderApp: typeof (window as unknown as { readerApp?: unknown }).readerApp !== 'undefined',
    }));

    await fs.writeFile(
      `${base}.json`,
      JSON.stringify({ url: page.url(), ...info }, null, 2),
      'utf8'
    );
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});

    logger.warn(`[DEBUG] Reader diagnostics saved: ${base}.png / ${base}.json (URL: ${page.url()})`);
    return base;
  } catch (error) {
    logger.debug({ error }, '[DEBUG] Could not save reader diagnostics');
    return null;
  }
}
