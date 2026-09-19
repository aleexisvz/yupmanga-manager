import fs from 'node:fs/promises';
import path from 'node:path';
import { PROGRESS_FILE_PATH } from '../config/defaults.js';
import type { ReadingProgressRecord } from '../config/types.js';

export class ProgressTracker {
  private records: Record<string, ReadingProgressRecord> = {};

  private async ensureFile(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(PROGRESS_FILE_PATH), { recursive: true });
      await fs.access(PROGRESS_FILE_PATH);
    } catch {
      await fs.writeFile(PROGRESS_FILE_PATH, '{}', 'utf-8');
    }
  }

  async load(): Promise<Record<string, ReadingProgressRecord>> {
    await this.ensureFile();
    try {
      const data = await fs.readFile(PROGRESS_FILE_PATH, 'utf-8');
      this.records = JSON.parse(data);
    } catch {
      this.records = {};
    }
    return this.records;
  }

  async save(): Promise<void> {
    await this.ensureFile();
    await fs.writeFile(PROGRESS_FILE_PATH, JSON.stringify(this.records, null, 2), 'utf-8');
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
