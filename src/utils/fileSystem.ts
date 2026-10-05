import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * Retries an asynchronous operation up to maxAttempts times if it fails.
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxAttempts = 5,
  delayMs = 50
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (
        (error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES') &&
        attempt < maxAttempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Atomically writes data to a JSON file.
 * Writes to a temporary file in the same directory first, then renames it to target.
 * This guarantees the original file is never left half-written or empty upon crashes/SIGINT.
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const content = JSON.stringify(data, null, 2);

  try {
    await fs.writeFile(tempPath, content, 'utf-8');

    // On Windows, fs.rename might temporarily conflict with file indexing or AV scanners,
    // so we use a small retry loop.
    await retryOperation(async () => {
      await fs.rename(tempPath, filePath);
    });
  } catch (error) {
    // Clean up temporary file if rename failed
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

/**
 * Creates a backup copy of a corrupted file so the user does not lose data.
 */
export async function backupCorruptedFile(filePath: string): Promise<string | null> {
  try {
    await fs.access(filePath);
    const backupPath = `${filePath}.bak.${Date.now()}`;
    await fs.copyFile(filePath, backupPath);
    logger.warn(`⚠️ Corrupted file backed up to: ${backupPath}`);
    return backupPath;
  } catch {
    return null;
  }
}
