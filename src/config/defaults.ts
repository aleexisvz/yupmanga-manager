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
  AD_MODAL_CONTAINER: 'div:has-text("Un momento y podrás seguir leyendo"), div:has(#btn-continue)',
  AD_COUNTDOWN_TEXT: 'text=/Espera \\d+ segundos/i',
  AD_CONTINUE_BUTTON: '#btn-continue, a:has-text("Continuar al capítulo"), a:has-text("Continuar al capitulo"), button:has-text("Continuar")',

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
  intervalMs: 15_000,          // 15 segundos base por página
  variationPercent: 45,        // Variación base (se vuelve dinámica por sesión entre 30% y 60%)
  mode: 'keyboard',
  proxy: undefined,
  behavior: {
    weights: {
      read_pages: 65,
      scroll_around: 10,
      short_break: 8,
      visit_home: 5,
      visit_profile: 4,
      visit_categories: 3,
      browse_manga: 3,
      long_break: 2,
    },
    shortBreakMinMs: 60_000,     // 1 minuto
    shortBreakMaxMs: 240_000,    // 4 minutos
    longBreakMinMs: 480_000,     // 8 minutos
    longBreakMaxMs: 1_200_000,   // 20 minutos
    pagesPerReadingSession: {
      min: 30,                   // Mínimo 30 páginas para asegurar guardado de progreso
      max: 100,                  // Máximo 100 páginas por sesión
    },
  },
  antiDetection: {
    useRealChrome: true,
    removeWebdriverFlag: true,
  },
};
