export interface ProfileStats {
  /** Current reading streak in days */
  streak: string;
  /** Chapters read */
  caps: string;
  /** Series read */
  series: string;
}

/**
 * Reads the current streak from the header streak badge title,
 * e.g. "Racha actual: 70 días. Récord: 70 días."
 */
export function parseHeaderStreak(title: string | null | undefined): string {
  const match = title?.match(/Racha\s+actual:\s*(\d+)/i);
  return match?.[1] ?? '';
}

/**
 * Extracts the stats from the /perfil page text (document.body.innerText).
 * The page lays them out one value per line:
 *   "Racha\nVer racha\n70\ndías"  and  "476\nCapítulos\n56\nSeries"
 * Achievements such as "Racha de 100 días 70/100" must not be read as the streak,
 * so only the "Ver racha" block and the legacy "N días Racha actual" layout are matched.
 */
export function parseProfileStats(text: string): ProfileStats {
  const streakMatch =
    text.match(/Ver\s+racha\s+(\d+)\s*d[ií]as/i) || text.match(/(\d+)\s*d[ií]as\s*Racha\s+actual/i);
  const capsMatch = text.match(/(\d+)\s*Cap[ií]tulos\b/i) || text.match(/(\d+)\s*Caps\b/i);
  const seriesMatch = text.match(/(\d+)\s*Series\b/i);

  return {
    streak: streakMatch?.[1] ?? '',
    caps: capsMatch?.[1] ?? '',
    series: seriesMatch?.[1] ?? '',
  };
}
