import { logger } from '../logger.js';

export type CleanupFunction = () => Promise<void>;

/**
 * Registers process lifecycle signal handlers to ensure clean browser exit
 * and state persistence upon interruptions or process terminations.
 *
 * @returns A teardown function to unbind signal handlers when no longer needed.
 */
export function setupGracefulShutdown(cleanupFn: CleanupFunction): () => void {
  let isShuttingDown = false;

  const handleShutdown = async (trigger: string, exitCode = 0, error?: unknown) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (error) {
      logger.error({ error }, `\n💥 Fatal error (${trigger}). Initiating graceful shutdown...`);
    } else {
      logger.warn(`\n🛑 Signal ${trigger} received. Initiating graceful shutdown...`);
    }

    // Set emergency exit timer in case cleanup hangs (e.g. stalled network socket)
    const emergencyTimer = setTimeout(() => {
      logger.error('⚠️ Graceful shutdown timed out (5s limit reached). Forcing process exit.');
      process.exit(1);
    }, 5000);
    emergencyTimer.unref();

    try {
      await cleanupFn();
      logger.info('✅ Shutdown completed cleanly.');
      process.exit(exitCode);
    } catch (cleanupError) {
      logger.error({ cleanupError }, '❌ Error encountered during graceful shutdown.');
      process.exit(1);
    }
  };

  const onSigInt = () => {
    handleShutdown('SIGINT', 0);
  };
  const onSigTerm = () => {
    handleShutdown('SIGTERM', 0);
  };
  const onSigHup = () => {
    handleShutdown('SIGHUP', 0);
  };
  const onUncaughtException = (err: Error) => {
    handleShutdown('uncaughtException', 1, err);
  };
  const onUnhandledRejection = (reason: unknown) => {
    handleShutdown('unhandledRejection', 1, reason);
  };

  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigTerm);
  process.once('SIGHUP', onSigHup);
  process.once('uncaughtException', onUncaughtException);
  process.once('unhandledRejection', onUnhandledRejection);

  return () => {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
    process.removeListener('SIGHUP', onSigHup);
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
  };
}
