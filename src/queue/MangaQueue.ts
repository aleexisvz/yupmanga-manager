import fs from 'node:fs/promises';
import { QUEUE_FILE_PATH } from '../config/defaults.js';
import { MangaQueueSchema } from '../config/schemas.js';
import type { MangaEntry } from '../config/types.js';
import { atomicWriteJson, backupCorruptedFile } from '../utils/fileSystem.js';
import { logger } from '../logger.js';

export class MangaQueue {
  private entries: MangaEntry[] = [];

  constructor(private filePath: string = QUEUE_FILE_PATH) {}

  private async ensureFileExists(): Promise<void> {
    try {
      await fs.access(this.filePath);
    } catch {
      await atomicWriteJson(this.filePath, []);
    }
  }

  async load(): Promise<MangaEntry[]> {
    await this.ensureFileExists();
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content);
      this.entries = MangaQueueSchema.parse(parsed) as MangaEntry[];
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        logger.warn({ error }, '[QUEUE] Corrupted or invalid queue file. Creating backup...');
        await backupCorruptedFile(this.filePath);
      }
      this.entries = [];
    }
    return this.entries;
  }

  async save(): Promise<void> {
    await atomicWriteJson(this.filePath, this.entries);
  }

  async add(url: string, title: string): Promise<MangaEntry> {
    await this.load();

    const existing = this.entries.find((m) => m.url === url);
    if (existing) {
      existing.status = 'queued';
      await this.save();
      return existing;
    }

    const newEntry: MangaEntry = {
      url,
      title,
      priority: this.entries.length + 1,
      status: 'queued',
      addedAt: new Date().toISOString(),
    };

    this.entries.push(newEntry);
    await this.save();
    logger.info(`[QUEUE] Added series to queue: "${title}" (${url})`);
    return newEntry;
  }

  async remove(url: string): Promise<boolean> {
    await this.load();
    const initialLength = this.entries.length;
    this.entries = this.entries.filter((m) => m.url !== url);

    if (this.entries.length !== initialLength) {
      await this.save();
      logger.info(`[QUEUE] Removed series from queue: ${url}`);
      return true;
    }

    return false;
  }

  async list(): Promise<MangaEntry[]> {
    return this.load();
  }

  /**
   * Obtiene el siguiente manga elegible para leer (ordenado por prioridad)
   */
  async getNext(): Promise<MangaEntry | null> {
    await this.load();

    // 1. Buscar el que esté en progreso de lectura
    const reading = this.entries.find((m) => m.status === 'reading');
    if (reading) return reading;

    // 2. Buscar el siguiente en cola por prioridad
    const queued = this.entries
      .filter((m) => m.status === 'queued')
      .sort((a, b) => a.priority - b.priority);

    if (queued.length > 0 && queued[0]) {
      queued[0].status = 'reading';
      await this.save();
      return queued[0];
    }

    return null;
  }

  async updateProgress(
    url: string,
    progress: Partial<NonNullable<MangaEntry['progress']>>,
    status?: MangaEntry['status']
  ): Promise<void> {
    await this.load();
    const entry = this.entries.find((m) => m.url === url);
    if (entry) {
      entry.progress = {
        ...entry.progress,
        ...progress,
      };
      entry.lastReadAt = new Date().toISOString();
      if (status) {
        entry.status = status;
      }
      await this.save();
    }
  }
}
