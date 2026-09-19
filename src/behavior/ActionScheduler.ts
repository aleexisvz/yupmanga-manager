import type { ActionType, AppConfig } from '../config/types.js';
import { uglyRandom } from '../utils/delay.js';

export interface SessionContext {
  pagesReadInCurrentSession: number;
  sessionStartTime: number;
  lastAction: ActionType | null;
  lastProfileVisitTimestamp: number;
  lastCategoryVisitTimestamp: number;
  lastBreakTimestamp: number;
}

export interface ScheduledAction {
  type: ActionType;
  pagesToRead?: number;
}

export class ActionScheduler {
  constructor(private config: AppConfig) {}

  /**
   * Decides next action based on weighted probability and fatigue context
   */
  getNextAction(context: SessionContext): ScheduledAction {
    const weights: Record<ActionType, number> = { ...this.config.behavior.weights };
    const now = Date.now();

    // 1. Fatigue adjustments for long reading sessions (70+ pages)
    if (context.pagesReadInCurrentSession >= 70) {
      weights.short_break += 20;
      weights.scroll_around += 15;
      weights.read_pages = Math.max(25, weights.read_pages - 25);
    }

    // 2. Reading session duration fatigue (> 60 minutes)
    const readingMinutes = (now - context.sessionStartTime) / 60_000;
    if (readingMinutes > 60) {
      weights.long_break += 10;
      weights.short_break += 15;
    }

    // 3. Avoid visiting profile too frequently (< 15 minutes)
    if (now - context.lastProfileVisitTimestamp < 15 * 60_000) {
      weights.visit_profile = 0;
    }

    // 4. Avoid visiting categories too frequently (< 20 minutes)
    if (now - context.lastCategoryVisitTimestamp < 20 * 60_000) {
      weights.visit_categories = 0;
    }

    // 5. Avoid back-to-back breaks (< 8 minutes)
    if (now - context.lastBreakTimestamp < 8 * 60_000) {
      weights.short_break = Math.max(2, weights.short_break - 15);
      weights.long_break = 0;
    }

    const actionType = this.weightedRandomChoice(weights);

    // Enforce 30 to 100 pages per reading session
    let pagesToRead: number | undefined;
    if (actionType === 'read_pages') {
      pagesToRead = Math.floor(uglyRandom(30, 100));
    }

    return {
      type: actionType,
      pagesToRead,
    };
  }

  private weightedRandomChoice(weights: Record<ActionType, number>): ActionType {
    const entries = Object.entries(weights) as [ActionType, number][];
    const totalWeight = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);

    let random = Math.random() * totalWeight;

    for (const [action, weight] of entries) {
      if (weight <= 0) continue;
      random -= weight;
      if (random <= 0) {
        return action;
      }
    }

    return 'read_pages';
  }
}
