import { describe, it, expect, vi } from 'vitest';
import { ReaderAutomation } from '../src/reader/ReaderAutomation.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import type { Page } from 'playwright';

describe('ReaderAutomation unit tests', () => {
  it('detects reading direction from DOM indicators', async () => {
    const reader = new ReaderAutomation();

    const mockPageRtl = {
      evaluate: vi.fn().mockResolvedValue('rtl'),
    } as unknown as Page;

    const dirRtl = await reader.detectDomReadingDirection(mockPageRtl);
    expect(dirRtl).toBe('rtl');

    const mockPageLtr = {
      evaluate: vi.fn().mockResolvedValue('ltr'),
    } as unknown as Page;

    const dirLtr = await reader.detectDomReadingDirection(mockPageLtr);
    expect(dirLtr).toBe('ltr');
  });

  it('turnPageForward advances with ArrowLeft when orientation is RTL', async () => {
    const reader = new ReaderAutomation();

    let currentPage = 1;
    const pressedKeys: string[] = [];

    const mockPage = {
      evaluate: vi.fn().mockImplementation((fn: any) => {
        // Return getPageInfo structure
        return Promise.resolve({ currentPage, totalPages: 100 });
      }),
      keyboard: {
        press: vi.fn().mockImplementation((key: string) => {
          pressedKeys.push(key);
          if (key === 'ArrowLeft') {
            currentPage++;
          }
          return Promise.resolve();
        }),
      },
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(false),
        }),
      }),
    } as unknown as Page;

    const result = await reader.turnPageForward(mockPage, DEFAULT_CONFIG, 'rtl');

    expect(result.advanced).toBe(true);
    expect(result.newPage).toBe(2);
    expect(result.detectedDirection).toBe('rtl');
    expect(pressedKeys).toContain('ArrowLeft');
  });

  it('turnPageForward auto-calibrates from RTL to LTR if page reverses', async () => {
    const reader = new ReaderAutomation();

    let currentPage = 50;
    const pressedKeys: string[] = [];

    const mockPage = {
      evaluate: vi.fn().mockImplementation(() => {
        return Promise.resolve({ currentPage, totalPages: 100 });
      }),
      keyboard: {
        press: vi.fn().mockImplementation((key: string) => {
          pressedKeys.push(key);
          // In LTR reader, ArrowLeft goes backwards, ArrowRight goes forward
          if (key === 'ArrowLeft') {
            currentPage--;
          } else if (key === 'ArrowRight') {
            currentPage++;
          }
          return Promise.resolve();
        }),
      },
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(false),
        }),
      }),
    } as unknown as Page;

    // We start with 'rtl' guess, but it's an LTR reader
    const result = await reader.turnPageForward(mockPage, DEFAULT_CONFIG, 'rtl');

    expect(result.advanced).toBe(true);
    // Page went 50 -> 49 (backward), then reversed with ArrowRight twice -> 51
    expect(result.newPage).toBe(51);
    expect(result.detectedDirection).toBe('ltr');
    expect(pressedKeys).toContain('ArrowRight');
  });

  it('turnPageForward tests opposite key when stuck on Page 1', async () => {
    const reader = new ReaderAutomation();

    let currentPage = 1;
    const pressedKeys: string[] = [];

    const mockPage = {
      evaluate: vi.fn().mockImplementation(() => {
        return Promise.resolve({ currentPage, totalPages: 100 });
      }),
      keyboard: {
        press: vi.fn().mockImplementation((key: string) => {
          pressedKeys.push(key);
          // ArrowRight does nothing on page 1 (backward key on RTL manga)
          // ArrowLeft advances forward
          if (key === 'ArrowLeft') {
            currentPage = 2;
          }
          return Promise.resolve();
        }),
      },
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(false),
        }),
      }),
    } as unknown as Page;

    // Start with LTR guess (ArrowRight), on page 1 of RTL manga
    const result = await reader.turnPageForward(mockPage, DEFAULT_CONFIG, 'ltr');

    expect(result.advanced).toBe(true);
    expect(result.newPage).toBe(2);
    expect(result.detectedDirection).toBe('rtl');
    expect(pressedKeys).toEqual(['ArrowRight', 'ArrowLeft']);
  });
});

