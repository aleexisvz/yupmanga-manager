import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { atomicWriteJson, backupCorruptedFile } from '../src/utils/fileSystem.js';

describe('Atomic File System Utilities', () => {
  const testDir = path.join(os.tmpdir(), `vitest-fs-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should atomically write valid JSON data to disk', async () => {
    const targetFile = path.join(testDir, 'data.json');
    const payload = { id: 42, name: 'YupManga', active: true };

    await atomicWriteJson(targetFile, payload);

    const raw = await fs.readFile(targetFile, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(payload);
  });

  it('should overwrite existing files atomically without data loss', async () => {
    const targetFile = path.join(testDir, 'overwrite.json');
    await atomicWriteJson(targetFile, { version: 1 });
    await atomicWriteJson(targetFile, { version: 2 });

    const raw = await fs.readFile(targetFile, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
  });

  it('should create a backup file when backing up corrupted data', async () => {
    await fs.mkdir(testDir, { recursive: true });
    const targetFile = path.join(testDir, 'corrupt.json');
    await fs.writeFile(targetFile, 'corrupted ::: json string', 'utf-8');

    const backupPath = await backupCorruptedFile(targetFile);
    expect(backupPath).toBeTruthy();
    expect(backupPath).toContain('.bak.');

    const backupExists = await fs.stat(backupPath!).then(() => true).catch(() => false);
    expect(backupExists).toBe(true);
  });

  it('should return null when attempting to back up a non-existent file', async () => {
    const nonExistent = path.join(testDir, 'does-not-exist.json');
    const result = await backupCorruptedFile(nonExistent);
    expect(result).toBeNull();
  });
});
