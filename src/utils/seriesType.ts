import type { SeriesType } from '../config/types.js';

/**
 * Infers the series type from a series page title or catalog card label.
 * Series pages are titled like "Mi querida enemiga en Español - Leer Manhwa Online | YupManga",
 * and catalog cards carry labels such as "MANHWA FINALIZADO".
 */
export function parseSeriesType(text: string | null | undefined): SeriesType | null {
  if (!text) return null;

  // Drop the site name so "YupManga" never counts as a manga hint
  const normalized = text.replace(/yupmanga/gi, ' ');

  const explicit = normalized.match(/leer\s+(manga|manhwa|manhua|webtoon|novela|novel)\b/i);
  const hint = explicit?.[1] ?? normalized.match(/\b(manhwa|manhua|webtoon|novela|novel|manga)\b/i)?.[1];
  if (!hint) return null;

  switch (hint.toLowerCase()) {
    case 'manhwa':
    case 'manhua':
    case 'webtoon':
      return 'manhwa';
    case 'novela':
    case 'novel':
      return 'novel';
    default:
      return 'manga';
  }
}

export const SERIES_TYPE_LABELS: Record<SeriesType, string> = {
  manga: 'Manga',
  manhwa: 'Manhwa',
  novel: 'Novela',
};
