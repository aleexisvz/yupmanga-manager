import type { ReadingSpeed } from '../config/types.js';
import { SPEED_PROFILES } from '../config/defaults.js';

/**
 * Pausa la ejecución por una cantidad de milisegundos, con soporte opcional de AbortSignal
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Sleep aborted'));
    }

    const timer = setTimeout(() => {
      resolve();
    }, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Sleep aborted'));
    });
  });
}

/**
 * Genera un número aleatorio no-redondo ("feo") con decimales para parecer humano
 */
export function uglyRandom(min: number, max: number): number {
  const value = min + Math.random() * (max - min);
  // Redondear a 2 decimales para evitar patrones fijos
  return Math.round(value * 100) / 100;
}

/**
 * Calcula un intervalo aleatorio alrededor de una base con porcentaje de variación (legacy)
 */
export function randomInterval(baseMs: number, variationPercent: number): number {
  const variation = baseMs * (variationPercent / 100);
  const min = baseMs - variation;
  const max = baseMs + variation;
  return Math.floor(uglyRandom(min, max));
}

export interface PageDelayResult {
  delayMs: number;
  delaySeconds: number;
  isMicroPause: boolean;
  extraPauseSeconds?: number;
}

/**
 * Calcula el intervalo de cambio de página según la velocidad seleccionada.
 * Utiliza una distribución triangular (aproximación gaussiana) para centrar la mayoría
 * de los tiempos en la media del rango y evitar saltos bruscos.
 * Además, incluye un 10% de probabilidad de micro-pausa humana (+3 a +6s) simulando
 * contemplación de doble página o distracción leve.
 */
export function calculatePageDelay(
  speed: ReadingSpeed = 'normal',
  timeMultiplier = 1.0,
  enableMicroPauses = true
): PageDelayResult {
  const profile = SPEED_PROFILES[speed] || SPEED_PROFILES.normal;
  const { minSeconds, maxSeconds } = profile;

  // Promedio de dos números aleatorios (aproximación triangular/gaussiana)
  const randomFactor = (Math.random() + Math.random()) / 2;
  let delaySeconds = minSeconds + randomFactor * (maxSeconds - minSeconds);

  let isMicroPause = false;
  let extraPauseSeconds = 0;

  // 10% de probabilidad de micro-pausa humana (+3s a +6s)
  if (enableMicroPauses && Math.random() < 0.1) {
    isMicroPause = true;
    extraPauseSeconds = uglyRandom(3.0, 6.0);
    delaySeconds += extraPauseSeconds;
  }

  // Aplicar factor horario (madrugada, noche, etc.)
  const adjustedSeconds = delaySeconds * timeMultiplier;
  const delayMs = Math.round(adjustedSeconds * 1000);

  return {
    delayMs,
    delaySeconds: Math.round(adjustedSeconds * 100) / 100,
    isMicroPause,
    extraPauseSeconds: isMicroPause ? extraPauseSeconds : undefined,
  };
}

/**
 * Ajusta los tiempos según la hora local:
 * En horas de madrugada la gente lee más despacio o toma descansos más largos.
 */
export function getTimeMultiplier(): number {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 6) return 1.6;  // Madrugada
  if (hour >= 6 && hour < 10) return 1.25; // Mañana temprana
  if (hour >= 10 && hour < 18) return 1.0; // Horario diurno regular
  if (hour >= 18 && hour < 22) return 0.95; // Tarde/noche pico
  return 1.3;                             // Noche tardía
}
