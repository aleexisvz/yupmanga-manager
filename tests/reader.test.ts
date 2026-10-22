import { describe, it, expect, vi } from 'vitest';
import { ReaderAutomation } from '../src/reader/ReaderAutomation.js';
import { DEFAULT_CONFIG, SELECTORS } from '../src/config/defaults.js';
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

describe('ReaderAutomation.closeReader', () => {
  interface MockButton {
    isVisible: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
  }

  function mockReaderPage(opts: {
    endPanelVisible: () => boolean;
    closeClick?: () => Promise<void>;
    webtoonFabVisible?: boolean;
  }) {
    const buttons: Record<string, MockButton> = {
      [SELECTORS.READER_END_PANEL]: {
        isVisible: vi.fn().mockImplementation(() => Promise.resolve(opts.endPanelVisible())),
        click: vi.fn(),
      },
      [SELECTORS.READER_CLOSE_BUTTON]: {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockImplementation(opts.closeClick ?? (() => Promise.resolve())),
      },
      [SELECTORS.READER_WEBTOON_CLOSE_FAB]: {
        isVisible: vi.fn().mockResolvedValue(opts.webtoonFabVisible ?? false),
        click: vi.fn().mockResolvedValue(undefined),
      },
      [SELECTORS.READER_END_PANEL_TO_SERIES]: {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      },
    };
    const page = {
      isClosed: () => false,
      locator: vi.fn().mockImplementation((selector: string) => ({ first: () => buttons[selector] })),
      waitForEvent: vi.fn().mockResolvedValue(null),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    return {
      page,
      closeBtn: buttons[SELECTORS.READER_CLOSE_BUTTON]!,
      toSeriesBtn: buttons[SELECTORS.READER_END_PANEL_TO_SERIES]!,
      closeFab: buttons[SELECTORS.READER_WEBTOON_CLOSE_FAB]!,
    };
  }

  async function runClose(page: Page) {
    const reader = new ReaderAutomation();
    vi.spyOn(reader, 'handleAdIfPresent').mockResolvedValue(false);
    vi.useFakeTimers();
    const promise = reader.closeReader(page);
    await vi.runAllTimersAsync();
    const closed = await promise;
    vi.useRealTimers();
    return closed;
  }

  it('clicks Close when no end-of-series panel is open', async () => {
    const { page, closeBtn, toSeriesBtn } = mockReaderPage({ endPanelVisible: () => false });
    expect(await runClose(page)).toBe(true);
    expect(closeBtn.click).toHaveBeenCalledOnce();
    expect(toSeriesBtn.click).not.toHaveBeenCalled();
  });

  it('uses the floating webtoon close button, since the header hides while scrolling', async () => {
    const { page, closeBtn, closeFab } = mockReaderPage({ endPanelVisible: () => false, webtoonFabVisible: true });
    expect(await runClose(page)).toBe(true);
    expect(closeFab.click).toHaveBeenCalledOnce();
    expect(closeBtn.click).not.toHaveBeenCalled();
  });

  it('leaves through "Ir a la ficha" when the end-of-series panel covers the reader', async () => {
    const { page, closeBtn, toSeriesBtn } = mockReaderPage({ endPanelVisible: () => true });
    expect(await runClose(page)).toBe(true);
    expect(toSeriesBtn.click).toHaveBeenCalledOnce();
    expect(closeBtn.click).not.toHaveBeenCalled();
  });

  it('falls back to "Ir a la ficha" when the panel appears just before clicking Close', async () => {
    let panelOpen = false;
    const { page, toSeriesBtn } = mockReaderPage({
      endPanelVisible: () => panelOpen,
      closeClick: () => {
        // The backdrop pops up and intercepts the click until it times out
        panelOpen = true;
        return Promise.reject(new Error('Timeout 5000ms exceeded: element intercepts pointer events'));
      },
    });
    expect(await runClose(page)).toBe(true);
    expect(toSeriesBtn.click).toHaveBeenCalledOnce();
  });
});
