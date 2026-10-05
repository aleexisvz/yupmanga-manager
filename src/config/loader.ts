import fs from 'node:fs/promises';
import { CONFIG_FILE_PATH, DEFAULT_CONFIG } from './defaults.js';
import { AppConfigSchema } from './schemas.js';
import type { AppConfig } from './types.js';
import { atomicWriteJson, backupCorruptedFile } from '../utils/fileSystem.js';
import { logger } from '../logger.js';

export class ConfigLoader {
  static async load(): Promise<AppConfig> {
    try {
      const data = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      const validated = AppConfigSchema.parse(parsed);
      return validated as AppConfig;
    } catch (error: any) {
      // If the file existed but parsing or validation failed, create a backup
      if (error?.code !== 'ENOENT') {
        logger.warn({ error }, '⚠️ Corrupted or invalid configuration file. Creating backup and restoring defaults.');
        await backupCorruptedFile(CONFIG_FILE_PATH);
      }
      await this.save(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }

  static async save(config: AppConfig): Promise<void> {
    const validated = AppConfigSchema.parse(config);
    await atomicWriteJson(CONFIG_FILE_PATH, validated);
  }
}
