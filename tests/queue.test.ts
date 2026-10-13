import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MangaQueue } from '../src/queue/MangaQueue.js';

describe('MangaQueue - Auto Dequeue and Progression', () => {
  const testDir = path.join(os.tmpdir(), `vitest-queue-${Date.now()}`);
  const queueFile = path.join(testDir, 'queue.json');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('adds items to the queue and gets the first one by priority', async () => {
    const queue = new MangaQueue(queueFile);

    await queue.add('https://yupmanga.com/manga/series-1', 'Series 1');
    await queue.add('https://yupmanga.com/manga/series-2', 'Series 2');

    const first = await queue.getNext();
    expect(first).not.toBeNull();
    expect(first?.title).toBe('Series 1');
    expect(first?.status).toBe('reading');

    const list = await queue.list();
    expect(list.length).toBe(2);
  });

  it('automatically advances to next series when finished series is removed', async () => {
    const queue = new MangaQueue(queueFile);

    await queue.add('https://yupmanga.com/manga/series-1', 'Series 1');
    await queue.add('https://yupmanga.com/manga/series-2', 'Series 2');

    // First series starts reading
    const current = await queue.getNext();
    expect(current?.url).toBe('https://yupmanga.com/manga/series-1');

    // Series 1 finishes all volumes -> removed from queue
    const removed = await queue.remove('https://yupmanga.com/manga/series-1');
    expect(removed).toBe(true);

    // Check queue progression: next series should now be picked
    const next = await queue.getNext();
    expect(next).not.toBeNull();
    expect(next?.url).toBe('https://yupmanga.com/manga/series-2');
    expect(next?.status).toBe('reading');

    const remaining = await queue.list();
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.title).toBe('Series 2');
  });

  it('returns null when the last series is removed and queue is empty', async () => {
    const queue = new MangaQueue(queueFile);

    await queue.add('https://yupmanga.com/manga/lone-series', 'Lone Series');

    const current = await queue.getNext();
    expect(current?.title).toBe('Lone Series');

    // Remove the only series upon completion
    await queue.remove('https://yupmanga.com/manga/lone-series');

    // No more series ahead in queue
    const next = await queue.getNext();
    expect(next).toBeNull();

    const emptyList = await queue.list();
    expect(emptyList.length).toBe(0);
  });
});

