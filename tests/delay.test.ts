import { describe, it, expect } from 'vitest';
import { uglyRandom, randomInterval, getTimeMultiplier } from '../src/utils/delay.js';

describe('Delay & Randomization Calculations', () => {
  it('should generate ugly random numbers within requested bounds', () => {
    for (let i = 0; i < 50; i++) {
      const val = uglyRandom(500, 1500);
      expect(val).toBeGreaterThanOrEqual(500);
      expect(val).toBeLessThanOrEqual(1500);
    }
  });

  it('should calculate intervals within percentage variation', () => {
    const base = 10_000;
    const variationPercent = 20; // 8,000 to 12,000
    for (let i = 0; i < 50; i++) {
      const result = randomInterval(base, variationPercent);
      expect(result).toBeGreaterThanOrEqual(8000);
      expect(result).toBeLessThanOrEqual(12000);
    }
  });

  it('should return a positive time multiplier based on hour of day', () => {
    const multiplier = getTimeMultiplier();
    expect(multiplier).toBeGreaterThan(0);
    expect(multiplier).toBeLessThanOrEqual(2.0);
  });
});
