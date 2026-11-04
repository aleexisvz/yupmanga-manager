/**
 * Extracts the series name from a series page title.
 * Series pages are titled like "Mi querida enemiga en Español - Leer Manhwa Online | YupManga",
 * or "<name> - YupManga" for some series. Returns null for any other title (for example
 * a Cloudflare challenge page), so callers can fall back to a default name.
 */
export function parseSeriesTitle(pageTitle: string | null | undefined): string | null {
  if (!pageTitle) return null;

  const match = pageTitle.trim().match(/^(.+?)\s+-\s+(?:Leer\s+.+?|YupManga)(?:\s*\|.*)?$/i);
  const name = match?.[1]?.replace(/\s+en Español$/i, '').trim();

  return name || null;
}
