import { describe, it, expect } from 'vitest';
import { parseSeriesType, SERIES_TYPE_LABELS } from '../src/utils/seriesType.js';
import { resolveFixedDirection } from '../src/reader/ReaderAutomation.js';

describe('parseSeriesType (comic)', () => {
  it('detects comics from the series page title', () => {
    expect(
      parseSeriesType('La maldición de Brimstone: Anual en Español - Leer Comic Online | YupManga')
    ).toBe('comic');
    expect(parseSeriesType('Serie en Español - Leer Cómic Online | YupManga')).toBe('comic');
  });

  it('ignores the YupComic brand', () => {
    expect(parseSeriesType('Serie en Español - Leer Manga Online | YupComic')).toBe('manga');
    expect(parseSeriesType('YupComic - Comunidad')).toBeNull();
  });

  it('does not treat the bare word "comic" in an ordinary title as a comic', () => {
    expect(parseSeriesType('Comic Girls en Español | YupManga')).toBeNull();
  });

  it('labels comics as BETA', () => {
    expect(SERIES_TYPE_LABELS.comic).toBe('Comic (BETA)');
  });
});

describe('resolveFixedDirection', () => {
  it('lets an explicit global direction override the series type', () => {
    expect(resolveFixedDirection('rtl', 'ltr')).toBe('rtl');
    expect(resolveFixedDirection('ltr', 'rtl')).toBe('ltr');
  });

  it('uses the series direction for comics when the global setting is auto', () => {
    expect(resolveFixedDirection('auto', 'ltr')).toBe('ltr');
    expect(resolveFixedDirection(undefined, 'ltr')).toBe('ltr');
  });

  it('defers to the page when nothing is fixed', () => {
    expect(resolveFixedDirection('auto', undefined)).toBeNull();
    expect(resolveFixedDirection(undefined, undefined)).toBeNull();
  });
});
