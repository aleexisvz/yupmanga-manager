import path from 'node:path';
import os from 'node:os';
import type { AppConfig, ReadingSpeed, SpeedProfile } from './types.js';

export const USER_DATA_DIR = path.join(os.homedir(), '.yupmanga', 'browser-data');
export const CONFIG_FILE_PATH = path.join(os.homedir(), '.yupmanga', 'config.json');
export const QUEUE_FILE_PATH = path.join(os.homedir(), '.yupmanga', 'queue.json');
export const PROGRESS_FILE_PATH = path.join(os.homedir(), '.yupmanga', 'progress.json');
export const LOGS_DIR = path.join(os.homedir(), '.yupmanga', 'logs');

export const BASE_URL = 'https://www.yupmanga.com';

export const SPEED_PROFILES: Record<ReadingSpeed, SpeedProfile> = {
  fast: {
    id: 'fast',
    name: 'Rápido',
    icon: '⚡',
    description: 'Escaneo veloz y hojear páginas',
    minSeconds: 3,
    maxSeconds: 6,
    badge: '~3-6 seg',
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    icon: '📖',
    description: 'Ritmo estándar y dinámico de lectura',
    minSeconds: 7,
    maxSeconds: 12,
    badge: '~7-12 seg',
  },
  slow: {
    id: 'slow',
    name: 'Lento',
    icon: '☕',
    description: 'Lectura tranquila y detallada',
    minSeconds: 12,
    maxSeconds: 20,
    badge: '~12-20 seg',
  },
  very_slow: {
    id: 'very_slow',
    name: 'Muy Lento',
    icon: '🐢',
    description: 'Pausado / Máxima discreción',
    minSeconds: 20,
    maxSeconds: 35,
    badge: '~20-35 seg',
  },
};

export const SELECTORS = {
  // Gallery and volumes
  CHAPTER_LINK: 'a.chapter-link',
  VOLUME_BADGE: '[class*="absolute"][class*="top-0"][class*="left-0"]',
  PAGINATION_BUTTONS: 'a, button',
  PAGINATION_NEXT_REGEX: /^(siguiente|next|›|»)$/i,
  SERIES_CARDS: 'a[href*="/series/"], a[href*="/manga/"]',

  // Interstitial ad & transition
  AD_MODAL_CONTAINER:
    'div:has-text("Un momento y podrás seguir leyendo"), div:has(#continueBtn), div:has(#btn-continue)',
  AD_MESSAGE_TEXT: 'text="Un momento y podrás seguir leyendo"',
  AD_COUNTDOWN_TEXT: 'text=/Espera \\d+ segundos/i',
  AD_CONTINUE_BUTTON:
    '#continueBtn, #continueBtnMobileTop, .continue-button, #btn-continue, #btn-continue button, button:has-text("Continuar al capítulo"), a:has-text("Continuar al capítulo")',

  // Reader interface
  READER_PAGE_INFO: 'text=/Página\\s+\\d+\\s+de\\s+\\d+/i',
  READER_CLOSE_BUTTON: 'button:has-text("Cerrar")',
  READER_NEXT_BUTTON: 'button[aria-label="Next"], .reader-next, button:has-text(">")',
  READER_READY_INDICATORS: 'button:has-text("Cerrar"), text=/Página\\s+\\d+\\s+de\\s+\\d+/i',

  // Site navigation
  NAV_HOME: 'a[href="/"], a:has-text("Inicio")',
  NAV_CATEGORIES: 'a[href*="categorias"], a:has-text("Categorías")',
  NAV_LISTS: 'a[href*="listas"], a:has-text("Listas")',
  NAV_SEARCH: 'input[placeholder*="buscar" i]',
  NAV_PROFILE_AVATAR: 'img[alt*="avatar" i], a[href*="perfil"], a[href*="usuario"], button:has(img)',

  // Auth and challenge detection
  CLOUDFLARE_CHALLENGE: 'iframe[src*="challenges.cloudflare.com"], form#challenge-form, #cf-turnstile',
  HEADER_STREAK_TOPLINE: '.header-streak-topline',
  HEADER_USER: '.header-streak-topline p, [class*="username"], [class*="user-name"]',
  HEADER_STREAK_COUNT: '.header-streak-count',
  PROFILE_LINKS: 'a[href*="perfil"], a[href*="profile"]',
  LOGIN_LINKS: 'a[href*="login"], a[href*="ingresar"]',
} as const;

export const DEFAULT_CONFIG: AppConfig = {
  runMode: 'headless',
  readingSpeed: 'normal',
  intervalMs: 15_000,          // 15 segundos base por página (legacy fallback)
  variationPercent: 45,        // Variación base (legacy fallback)
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
