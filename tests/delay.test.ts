import { describe, it, expect } from 'vitest';
import { uglyRandom, randomInterval, getTimeMultiplier, calculatePageDelay } from '../src/utils/delay.js';

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

  describe('calculatePageDelay with speed presets', () => {
    it('should calculate delay within expected range for fast preset', () => {
      for (let i = 0; i < 30; i++) {
        const { delayMs, delaySeconds } = calculatePageDelay('fast', 1.0, false);
        expect(delayMs).toBeGreaterThanOrEqual(4000);
        expect(delayMs).toBeLessThanOrEqual(7000);
        expect(delaySeconds).toBeGreaterThanOrEqual(4.0);
        expect(delaySeconds).toBeLessThanOrEqual(7.0);
      }
    });

    it('should calculate delay within expected range for normal preset', () => {
      for (let i = 0; i < 30; i++) {
        const { delayMs } = calculatePageDelay('normal', 1.0, false);
        expect(delayMs).toBeGreaterThanOrEqual(7000);
        expect(delayMs).toBeLessThanOrEqual(12000);
      }
    });

    it('should calculate delay within expected range for slow preset', () => {
      for (let i = 0; i < 30; i++) {
        const { delayMs } = calculatePageDelay('slow', 1.0, false);
        expect(delayMs).toBeGreaterThanOrEqual(12000);
        expect(delayMs).toBeLessThanOrEqual(20000);
      }
    });

    it('should calculate delay within expected range for very_slow preset', () => {
      for (let i = 0; i < 30; i++) {
        const { delayMs } = calculatePageDelay('very_slow', 1.0, false);
        expect(delayMs).toBeGreaterThanOrEqual(20000);
        expect(delayMs).toBeLessThanOrEqual(35000);
      }
    });

    it('should apply time multiplier properly', () => {
      const { delayMs } = calculatePageDelay('normal', 1.5, false);
      expect(delayMs).toBeGreaterThanOrEqual(7000 * 1.5);
      expect(delayMs).toBeLessThanOrEqual(12000 * 1.5);
    });
  });
});
