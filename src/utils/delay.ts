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
 * Calcula un intervalo aleatorio alrededor de una base con porcentaje de variación
 */
export function randomInterval(baseMs: number, variationPercent: number): number {
  const variation = baseMs * (variationPercent / 100);
  const min = baseMs - variation;
  const max = baseMs + variation;
  return Math.floor(uglyRandom(min, max));
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
