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
   * Decide cuál debe ser la siguiente acción basada en probabilidades ponderadas y contexto
   */
  getNextAction(context: SessionContext): ScheduledAction {
    const weights: Record<ActionType, number> = { ...this.config.behavior.weights };
    const now = Date.now();

    // 1. Ajustes dinámicos según fatiga de lectura
    if (context.pagesReadInCurrentSession >= 25) {
      weights.short_break += 20;
      weights.scroll_around += 15;
      weights.read_pages = Math.max(20, weights.read_pages - 25);
    }

    // 2. Si acaba de leer muchas páginas continuas y lleva más de 60 min, fomentar descanso
    const readingMinutes = (now - context.sessionStartTime) / 60_000;
    if (readingMinutes > 60) {
      weights.long_break += 10;
      weights.short_break += 15;
    }

    // 3. Evitar visitar el perfil con demasiada frecuencia (< 15 minutos)
    if (now - context.lastProfileVisitTimestamp < 15 * 60_000) {
      weights.visit_profile = 0;
    }

    // 4. Evitar visitar categorías con demasiada frecuencia (< 20 minutos)
    if (now - context.lastCategoryVisitTimestamp < 20 * 60_000) {
      weights.visit_categories = 0;
    }

    // 5. Evitar descansos repetidos si el último fue hace menos de 8 minutos
    if (now - context.lastBreakTimestamp < 8 * 60_000) {
      weights.short_break = Math.max(2, weights.short_break - 15);
      weights.long_break = 0;
    }

    // 6. Selección aleatoria ponderada
    const actionType = this.weightedRandomChoice(weights);

    // 7. Si la acción es leer páginas, determinar cantidad orgánica de páginas
    let pagesToRead: number | undefined;
    if (actionType === 'read_pages') {
      const min = this.config.behavior.pagesPerReadingSession.min;
      const max = this.config.behavior.pagesPerReadingSession.max;
      pagesToRead = Math.floor(uglyRandom(min, max));
    }

    return {
      type: actionType,
      pagesToRead,
    };
  }

  /**
   * Algoritmo de ruleta para selección ponderada
   */
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
