import path from 'node:path';
import os from 'node:os';
import type { AppConfig } from './types.js';

export const USER_DATA_DIR = path.join(os.homedir(), '.yupmanga', 'browser-data');
export const CONFIG_FILE_PATH = path.join(os.homedir(), '.yupmanga', 'config.json');
export const QUEUE_FILE_PATH = path.join(os.homedir(), '.yupmanga', 'queue.json');
export const PROGRESS_FILE_PATH = path.join(os.homedir(), '.yupmanga', 'progress.json');
export const LOGS_DIR = path.join(os.homedir(), '.yupmanga', 'logs');

export const BASE_URL = 'https://yupmanga.com';

export const SELECTORS = {
  // Galería y volúmenes
  CHAPTER_LINK: 'a.chapter-link',
  VOLUME_BADGE: '[class*="absolute"][class*="top-0"][class*="left-0"]',
  
  // Publicidad intermedia previa al reader
  AD_MODAL_CONTAINER: 'div:has-text("Un momento y podrás seguir leyendo")',
  AD_COUNTDOWN_TEXT: 'text=/Espera \\d+ segundos/i',
  AD_CONTINUE_BUTTON: 'button:has-text("Continuar"), a:has-text("Continuar")',

  // Reader
  READER_PAGE_INFO: 'text=/Página\\s+\\d+\\s+de\\s+\\d+/i',
  READER_CLOSE_BUTTON: 'button:has-text("Cerrar")',
  READER_NEXT_BUTTON: 'button[aria-label="Next"], .reader-next, button:has-text(">")',
  
  // Navegación del sitio
  NAV_HOME: 'a[href="/"], a:has-text("Inicio")',
  NAV_CATEGORIES: 'a[href*="categorias"], a:has-text("Categorías")',
  NAV_LISTS: 'a[href*="listas"], a:has-text("Listas")',
  NAV_SEARCH: 'input[placeholder*="buscar" i]',
  NAV_PROFILE_AVATAR: 'img[alt*="avatar" i], a[href*="perfil"], a[href*="usuario"], button:has(img)',
} as const;

export const DEFAULT_CONFIG: AppConfig = {
  runMode: 'headless',
  intervalMs: 5200,
  variationPercent: 25,
  mode: 'keyboard',
  proxy: undefined,
  behavior: {
    weights: {
      read_pages: 60,
      scroll_around: 12,
      short_break: 8,
      visit_home: 5,
      visit_profile: 4,
      visit_categories: 4,
      browse_manga: 4,
      long_break: 3,
    },
    shortBreakMinMs: 45_000,     // 45 segundos
    shortBreakMaxMs: 165_000,    // ~2.75 minutos
    longBreakMinMs: 420_000,     // ~7 minutos
    longBreakMaxMs: 1_260_000,   // ~21 minutos
    pagesPerReadingSession: {
      min: 8,
      max: 32,
    },
  },
  antiDetection: {
    useRealChrome: true,
    removeWebdriverFlag: true,
  },
};
