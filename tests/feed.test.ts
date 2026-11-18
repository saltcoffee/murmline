import type { TFile } from 'obsidian';
import { expect, it, vi } from 'vitest';
import { Feed } from '../src/feed';
import { postPath } from '../src/post';

const id = (n: number) => (1794969720000 + n) + '_00000000-0000-4000-8000-000000000000';
function fixture(size: number) {
  const data = new Set(Array.from({ length: size }, (_, i) => id(i * 2)));
  const errors = new Set<string>();
  const source = {
    list: vi.fn(() => [...data]),
    file: (key: string) => data.has(key) ? {} as TFile : null,
    read: vi.fn(async (key: string) => {
      if (errors.has(key)) throw Error('Unreadable');
      return data.has(key) ? key : null;
    }),
  };
  return { feed: new Feed(source), data, errors, source };
}

it('inserts sync into loaded history and pages the rest without duplicates (A10)', async () => {
  const { feed, data } = fixture(100);
  await feed.page();
  expect(feed.rows.size).toBe(50);
  const incoming = id(161);
  data.add(incoming);
  await feed.changed(new Set([postPath(incoming)]));
  expect([...feed.rows.keys()].sort().reverse()[19]).toBe(incoming);
  await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
  expect(feed.more).toBe(false);
  data.add(id(1));
  await feed.changed(new Set([postPath(id(1))]));
  expect(feed.rows.has(id(1))).toBe(true);
});

it('keeps earlier history available past a failed read and retries in place (A11)', async () => {
  const { feed, errors } = fixture(55);
  const failed = id(8);
  errors.add(failed);
  await feed.page();
  await feed.page();
  expect(feed.rows.size).toBe(55);
  expect(feed.more).toBe(false);
  expect(feed.rows.get(failed)).toHaveProperty('error');
  errors.clear();
  await feed.reload(failed);
  expect(feed.rows.get(failed)).toEqual({ id: failed, text: failed });
  expect([...feed.rows.keys()].sort().reverse().indexOf(failed)).toBe(50);
});

it('retries enumeration, follows folder moves, and updates a previously empty view', async () => {
  const { feed, data, source } = fixture(0);
  source.list.mockImplementationOnce(() => { throw Error('Unavailable'); });
  await expect(feed.page()).rejects.toThrow();
  await feed.page();
  data.add(id(2));
  await feed.changed(new Set(['Murmur']));
  expect(feed.rows.has(id(2))).toBe(true);
  data.clear();
  await feed.changed(new Set(['Murmur']));
  expect(feed.rows.size).toBe(0);
});

it('loads 10,000 records on demand and accepts record 10,001', async () => {
  const { feed, source, data } = fixture(10_000);
  await feed.page();
  expect(source.read).toHaveBeenCalledTimes(50);
  while (feed.more) await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
  data.add(id(20_000));
  await feed.changed(new Set([postPath(id(20_000))]));
  expect(feed.rows.size).toBe(10_001);
});

it.each(['folder', 'files'])('paginates a 10,000-post %s import into an open empty timeline', async event => {
  const { feed, source, data } = fixture(0);
  await feed.page();
  for (let n = 0; n < 10_000; n++) data.add(id(n));
  const paths = event === 'folder' ? ['Murmur/2026-11'] : [...data].map(postPath);
  await feed.changed(new Set(paths));
  expect(source.read).toHaveBeenCalledTimes(50);
  expect([...feed.rows.keys()]).toEqual([...data].reverse().slice(0, 50));
  expect(feed.more).toBe(true);

  // A separate notification for a file already indexed must not eagerly read it.
  await feed.changed(new Set([postPath(id(1))]));
  expect(source.read).toHaveBeenCalledTimes(50);
  expect(await feed.page()).toBe(id(9949));
  while (feed.more) await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
  expect(source.read).toHaveBeenCalledTimes(10_000);
});

it('fills unread gaps on both sides of previously loaded records after a bulk sync', async () => {
  const { feed, data } = fixture(120);
  await feed.page();
  const paths = new Set<string>();
  for (let n = 1; n < 300; n += 2) {
    data.add(id(n));
    paths.add(postPath(id(n)));
  }
  await feed.changed(paths);
  expect(feed.rows.size).toBe(100);
  expect(feed.rows.has(id(299))).toBe(true);
  // An indexed but unread file can be removed before pagination reaches it.
  data.delete(id(1));
  await feed.changed(new Set([postPath(id(1))]));
  while (feed.more) await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
});
