import { describe, it, expect } from 'vitest';
import { parseHeaderStreak, parseProfileStats } from '../src/utils/profileStats.js';

// Excerpt of the real /perfil innerText (one value per line)
const PROFILE_TEXT = [
  'Inicio',
  'Biblioteca',
  'Actividad',
  'Social',
  'Racha',
  'Ver racha',
  '70',
  'días',
  ' Racha de hoy asegurada',
  'Logros',
  'Ver todo',
  '476',
  'Capítulos',
  '56',
  'Series',
  '24D y 12H',
  'Tiempo',
  'TE FALTA POCO',
  'Nivel 10',
  '9/10',
  'Enciclopedia',
  '20/25',
  'Racha de 100 días',
  '70/100',
  'Seguir leyendo',
].join('\n');

describe('parseHeaderStreak', () => {
  it('reads the current streak from the header badge title', () => {
    expect(parseHeaderStreak('Racha actual: 70 días. Récord: 70 días.')).toBe('70');
    expect(parseHeaderStreak('Racha actual: 3 días. Récord: 120 días.')).toBe('3');
  });

  it('returns an empty string when the title is missing', () => {
    expect(parseHeaderStreak(null)).toBe('');
    expect(parseHeaderStreak('')).toBe('');
  });
});

describe('parseProfileStats', () => {
  it('reads the streak from "Ver racha", not from the "Racha de 100 días" achievement', () => {
    expect(parseProfileStats(PROFILE_TEXT).streak).toBe('70');
  });

  it('reads chapters ("Capítulos") and series counts', () => {
    const stats = parseProfileStats(PROFILE_TEXT);
    expect(stats.caps).toBe('476');
    expect(stats.series).toBe('56');
  });

  it('never takes the streak from an achievement alone', () => {
    expect(parseProfileStats('Logros\nRacha de 100 días\n70/100').streak).toBe('');
  });

  it('still supports the legacy "N días Racha actual" layout and "Caps" label', () => {
    const stats = parseProfileStats('12 días Racha actual\n300 Caps\n9 Series');
    expect(stats).toEqual({ streak: '12', caps: '300', series: '9' });
  });
});
