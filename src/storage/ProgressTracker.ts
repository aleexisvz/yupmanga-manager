import fs from 'node:fs/promises';
import { PROGRESS_FILE_PATH } from '../config/defaults.js';
import { ReadingProgressMapSchema } from '../config/schemas.js';
import type { ReadingProgressRecord } from '../config/types.js';
import { atomicWriteJson, backupCorruptedFile } from '../utils/fileSystem.js';
import { logger } from '../logger.js';

export class ProgressTracker {
  private records: Record<string, ReadingProgressRecord> = {};

  private async ensureFile(): Promise<void> {
    try {
      await fs.access(PROGRESS_FILE_PATH);
    } catch {
      await atomicWriteJson(PROGRESS_FILE_PATH, {});
    }
  }

  async load(): Promise<Record<string, ReadingProgressRecord>> {
    await this.ensureFile();
    try {
      const data = await fs.readFile(PROGRESS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      this.records = ReadingProgressMapSchema.parse(parsed) as Record<string, ReadingProgressRecord>;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        logger.warn({ error }, '⚠️ Corrupted or invalid progress file. Creating backup...');
        await backupCorruptedFile(PROGRESS_FILE_PATH);
      }
      this.records = {};
    }
    return this.records;
  }

  async save(): Promise<void> {
    await atomicWriteJson(PROGRESS_FILE_PATH, this.records);
  }

  async recordSession(
    url: string,
    title: string,
    pagesRead: number,
    volumeCompleted: boolean,
    lastVolumeTitle?: string,
    lastPage?: number
  ): Promise<void> {
    await this.load();

    const existing = this.records[url] || {
      url,
      title,
      totalVolumesCompleted: 0,
      lastVolume: lastVolumeTitle,
      lastPage: lastPage || 1,
      lastReadTimestamp: new Date().toISOString(),
      sessionsCount: 0,
      totalPagesReadAccumulated: 0,
    };

    existing.totalPagesReadAccumulated += pagesRead;
    existing.sessionsCount += 1;
    existing.lastReadTimestamp = new Date().toISOString();
    if (lastVolumeTitle) existing.lastVolume = lastVolumeTitle;
    if (lastPage) existing.lastPage = lastPage;
    if (volumeCompleted) existing.totalVolumesCompleted += 1;

    this.records[url] = existing;
    await this.save();
  }

  async getAll(): Promise<ReadingProgressRecord[]> {
    await this.load();
    return Object.values(this.records);
  }

  async get(url: string): Promise<ReadingProgressRecord | null> {
    await this.load();
    return this.records[url] || null;
  }
}
