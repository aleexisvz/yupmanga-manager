import { logger } from '../logger.js';

export function setupGracefulShutdown(cleanupFn: () => Promise<void>): void {
  let isShuttingDown = false;

  const handleSignal = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.warn(`\n🛑 Señal ${signal} recibida. Cerrando ordenadamente y guardando sesión...`);
    try {
      await cleanupFn();
      logger.info('✅ Cierre completado con éxito.');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, '❌ Error durante el apagado');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}
