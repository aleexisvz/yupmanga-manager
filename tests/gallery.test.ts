import { describe, it, expect, vi } from 'vitest';
import { GalleryNavigator } from '../src/navigator/GalleryNavigator.js';
import type { Page, Locator } from 'playwright';

describe('GalleryNavigator - Series Completion Validation', () => {
  it('returns isComplete: true when all volumes on page are completed and no next page exists', async () => {
    const gallery = new GalleryNavigator();

    // Mock 3 volume locators, all with completed badge
    const mockLocators = [
      {
        evaluate: vi.fn().mockImplementation((fn: any) => 'completed'),
      },
      {
        evaluate: vi.fn().mockImplementation((fn: any) => 'completed'),
      },
      {
        evaluate: vi.fn().mockImplementation((fn: any) => 'completed'),
      },
    ];

    const mockPage = {
      locator: vi.fn().mockImplementation((selector: string) => {
        return {
          count: vi.fn().mockResolvedValue(mockLocators.length),
          nth: vi.fn().mockImplementation((i: number) => mockLocators[i]),
          filter: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        };
      }),
    } as unknown as Page;

    const result = await gallery.validateSeriesCompleted(mockPage);

    expect(result.isComplete).toBe(true);
    expect(result.totalVolumes).toBe(3);
    expect(result.completedCount).toBe(3);
  });

  it('returns isComplete: false when some volumes are in-progress or not-started', async () => {
    const gallery = new GalleryNavigator();

    const mockLocators = [
      { evaluate: vi.fn().mockResolvedValue('completed') },
      { evaluate: vi.fn().mockResolvedValue('in-progress') },
      { evaluate: vi.fn().mockResolvedValue('not-started') },
    ];

    const mockPage = {
      locator: vi.fn().mockImplementation((selector: string) => {
        return {
          count: vi.fn().mockResolvedValue(mockLocators.length),
          nth: vi.fn().mockImplementation((i: number) => mockLocators[i]),
          filter: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        };
      }),
    } as unknown as Page;

    const result = await gallery.validateSeriesCompleted(mockPage);

    expect(result.isComplete).toBe(false);
    expect(result.totalVolumes).toBe(3);
    expect(result.completedCount).toBe(1);
  });

  it('returns isComplete: false when current page is completed but next gallery page exists', async () => {
    const gallery = new GalleryNavigator();

    const mockLocators = [
      { evaluate: vi.fn().mockResolvedValue('completed') },
      { evaluate: vi.fn().mockResolvedValue('completed') },
    ];

    const mockNextButton = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
    };

    const mockPage = {
      locator: vi.fn().mockImplementation((selector: string) => {
        return {
          count: vi.fn().mockResolvedValue(mockLocators.length),
          nth: vi.fn().mockImplementation((i: number) => mockLocators[i]),
          filter: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(1),
            nth: vi.fn().mockReturnValue(mockNextButton),
          }),
        };
      }),
    } as unknown as Page;

    const result = await gallery.validateSeriesCompleted(mockPage);

    expect(result.isComplete).toBe(false);
    expect(result.totalVolumes).toBe(2);
    expect(result.completedCount).toBe(2);
  });

  it('returns isComplete: false when zero volumes are found on page', async () => {
    const gallery = new GalleryNavigator();

    const mockPage = {
      locator: vi.fn().mockImplementation(() => {
        return {
          count: vi.fn().mockResolvedValue(0),
          filter: vi.fn().mockReturnValue({
            count: vi.fn().mockResolvedValue(0),
          }),
        };
      }),
    } as unknown as Page;

    const result = await gallery.validateSeriesCompleted(mockPage);

    expect(result.isComplete).toBe(false);
    expect(result.totalVolumes).toBe(0);
    expect(result.completedCount).toBe(0);
  });
});


describe('GalleryNavigator - Series type detection', () => {
  const pageWith = (title: string, formatLabel: string | null) =>
    ({
      title: vi.fn().mockResolvedValue(title),
      evaluate: vi.fn().mockResolvedValue(formatLabel),
    }) as unknown as Page;

  it('uses the page title when it names the type', async () => {
    const page = pageWith('Mi querida enemiga en Español - Leer Manhwa Online | YupManga', 'Webtoon');
    expect(await new GalleryNavigator().detectSeriesType(page)).toBe('manhwa');
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('falls back to the "Webtoon" format label when the title has no type', async () => {
    const page = pageWith('Estrella Ballena: La sirena de Gyeongseong - YupManga', 'Webtoon');
    expect(await new GalleryNavigator().detectSeriesType(page)).toBe('manhwa');
  });

  it('returns null when neither the title nor a format label names the type', async () => {
    const page = pageWith('Algo - YupManga', null);
    expect(await new GalleryNavigator().detectSeriesType(page)).toBeNull();
  });
});
