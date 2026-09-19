import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE_PATH, DEFAULT_CONFIG } from './defaults.js';
import type { AppConfig } from './types.js';

export class ConfigLoader {
  static async load(): Promise<AppConfig> {
    try {
      const data = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        behavior: {
          ...DEFAULT_CONFIG.behavior,
          ...(parsed.behavior || {}),
        },
        antiDetection: {
          ...DEFAULT_CONFIG.antiDetection,
          ...(parsed.antiDetection || {}),
        },
      };
    } catch {
      // Si no existe, guardar default
      await this.save(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }

  static async save(config: AppConfig): Promise<void> {
    const dir = path.dirname(CONFIG_FILE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
  }
}
