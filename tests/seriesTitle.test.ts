import { describe, it, expect } from 'vitest';
import { parseSeriesTitle } from '../src/utils/seriesTitle.js';

describe('parseSeriesTitle', () => {
  it('reads the series name from series page titles', () => {
    expect(parseSeriesTitle('Mi querida enemiga en Español - Leer Manhwa Online | YupManga')).toBe(
      'Mi querida enemiga'
    );
    expect(parseSeriesTitle('Be Blues en Español - Leer Manga Online | YupManga')).toBe('Be Blues');
    expect(parseSeriesTitle('2Moons en Español - Leer Novela Online | YupManga')).toBe('2Moons');
  });

  it('reads the series name from titles that only carry the site name', () => {
    expect(parseSeriesTitle('Solo Leveling - YupManga')).toBe('Solo Leveling');
  });

  it('keeps hyphens that belong to the series name', () => {
    expect(parseSeriesTitle('Spider-Man en Español - Leer Manga Online | YupManga')).toBe('Spider-Man');
  });

  it('returns null for titles that are not series pages', () => {
    expect(parseSeriesTitle('Comunidad de lectores | YupManga')).toBeNull();
    expect(parseSeriesTitle('Just a moment...')).toBeNull();
    expect(parseSeriesTitle('Attention Required! | Cloudflare')).toBeNull();
    expect(parseSeriesTitle('')).toBeNull();
    expect(parseSeriesTitle(null)).toBeNull();
  });
});
