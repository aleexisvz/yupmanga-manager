import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager } from '../src/browser/BrowserManager.js';
import { ConfigLoader } from '../src/config/loader.js';
import { chromium } from 'playwright';
import type { AppConfig } from '../src/config/types.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';

describe('BrowserManager - Launch Args and Setup Auto Mode Switching', () => {
  let mockConfig: AppConfig;

  beforeEach(() => {
    mockConfig = {
      ...DEFAULT_CONFIG,
      runMode: 'offscreen',
    };

    vi.spyOn(ConfigLoader, 'load').mockImplementation(async () => ({ ...mockConfig }));
    vi.spyOn(ConfigLoader, 'save').mockImplementation(async (cfg) => {
      mockConfig = { ...cfg };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildLaunchArgs', () => {
    it('sets offscreen window position for offscreen mode', () => {
      const browser = new BrowserManager();
      const args = browser.buildLaunchArgs('offscreen');
      expect(args).toContain('--window-position=-32000,-32000');
    });

    it('sets visible window position (50,50) for headed mode', () => {
      const browser = new BrowserManager();
      const args = browser.buildLaunchArgs('headed');
      expect(args).toContain('--window-position=50,50');
      expect(args).not.toContain('--window-position=-32000,-32000');
    });

    it('does not set window position for headless mode', () => {
      const browser = new BrowserManager();
      const args = browser.buildLaunchArgs('headless');
      expect(args.some((a) => a.includes('--window-position'))).toBe(false);
    });
  });

  describe('setup auto mode switching', () => {
    it('temporarily switches offscreen mode to headed, then restores offscreen when browser closes', async () => {
      mockConfig.runMode = 'offscreen';

      let modeDuringSetup = '';
      const closeCallbacks: (() => void)[] = [];

      const fakePage = {
        goto: vi.fn().mockResolvedValue(null),
        on: vi.fn(),
      };

      const fakeContext = {
        pages: () => [fakePage],
        newPage: vi.fn().mockResolvedValue(fakePage),
        on: (event: string, cb: () => void) => {
          if (event === 'close') closeCallbacks.push(cb);
        },
        close: vi.fn().mockImplementation(async () => {
          for (const cb of closeCallbacks) cb();
        }),
      };

      vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async () => {
        // At this point, setup() should have already switched runMode to 'headed'
        modeDuringSetup = mockConfig.runMode;

        // Simulate browser closing after a short tick
        setTimeout(() => {
          for (const cb of closeCallbacks) cb();
        }, 20);

        return fakeContext as any;
      });

      const browser = new BrowserManager();
      await browser.setup();

      // Verify that while Chrome was launching/running, runMode was 'headed'
      expect(modeDuringSetup).toBe('headed');

      // Verify that after setup() closed, runMode was restored back to 'offscreen'
      expect(mockConfig.runMode).toBe('offscreen');
    });

    it('temporarily switches headless mode to headed, then restores headless', async () => {
      mockConfig.runMode = 'headless';

      let modeDuringSetup = '';
      const closeCallbacks: (() => void)[] = [];

      const fakePage = {
        goto: vi.fn().mockResolvedValue(null),
        on: vi.fn(),
      };

      const fakeContext = {
        pages: () => [fakePage],
        newPage: vi.fn().mockResolvedValue(fakePage),
        on: (event: string, cb: () => void) => {
          if (event === 'close') closeCallbacks.push(cb);
        },
        close: vi.fn().mockImplementation(async () => {
          for (const cb of closeCallbacks) cb();
        }),
      };

      vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async () => {
        modeDuringSetup = mockConfig.runMode;
        setTimeout(() => {
          for (const cb of closeCallbacks) cb();
        }, 20);
        return fakeContext as any;
      });

      const browser = new BrowserManager();
      await browser.setup();

      expect(modeDuringSetup).toBe('headed');
      expect(mockConfig.runMode).toBe('headless');
    });

    it('leaves headed mode intact if already headed', async () => {
      mockConfig.runMode = 'headed';

      const saveSpy = vi.spyOn(ConfigLoader, 'save');
      const closeCallbacks: (() => void)[] = [];

      const fakePage = {
        goto: vi.fn().mockResolvedValue(null),
        on: vi.fn(),
      };

      const fakeContext = {
        pages: () => [fakePage],
        newPage: vi.fn().mockResolvedValue(fakePage),
        on: (event: string, cb: () => void) => {
          if (event === 'close') closeCallbacks.push(cb);
        },
        close: vi.fn().mockImplementation(async () => {
          for (const cb of closeCallbacks) cb();
        }),
      };

      vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async () => {
        setTimeout(() => {
          for (const cb of closeCallbacks) cb();
        }, 20);
        return fakeContext as any;
      });

      const browser = new BrowserManager();
      await browser.setup();

      expect(mockConfig.runMode).toBe('headed');
      // No extra save calls needed since it was already headed
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('restores previous runMode even if launchPersistentContext throws an error', async () => {
      mockConfig.runMode = 'offscreen';

      vi.spyOn(chromium, 'launchPersistentContext').mockRejectedValue(new Error('Browser crashed'));

      const browser = new BrowserManager();
      await expect(browser.setup()).rejects.toThrow('Browser crashed');

      // Even on failure, mode must be restored back to 'offscreen'
      expect(mockConfig.runMode).toBe('offscreen');
    });

    it('does not switch mode when autoSwitchMode is false', async () => {
      mockConfig.runMode = 'offscreen';

      const saveSpy = vi.spyOn(ConfigLoader, 'save');
      const closeCallbacks: (() => void)[] = [];

      const fakePage = {
        goto: vi.fn().mockResolvedValue(null),
        on: vi.fn(),
      };

      const fakeContext = {
        pages: () => [fakePage],
        newPage: vi.fn().mockResolvedValue(fakePage),
        on: (event: string, cb: () => void) => {
          if (event === 'close') closeCallbacks.push(cb);
        },
        close: vi.fn().mockImplementation(async () => {
          for (const cb of closeCallbacks) cb();
        }),
      };

      vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async () => {
        setTimeout(() => {
          for (const cb of closeCallbacks) cb();
        }, 20);
        return fakeContext as any;
      });

      const browser = new BrowserManager();
      await browser.setup(undefined, { autoSwitchMode: false });

      expect(mockConfig.runMode).toBe('offscreen');
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });
});
