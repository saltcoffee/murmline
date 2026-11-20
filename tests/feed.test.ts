import type { TFile } from 'obsidian';
import { expect, it, vi } from 'vitest';
import { Feed } from '../src/feed';
import { postPath } from '../src/post';
import { PostError } from '../src/post-store';

const id = (n: number) => (1794969720000 + n) + '_00000000-0000-4000-8000-000000000000';
function fixture(size: number) {
  const data = new Set(Array.from({ length: size }, (_, i) => id(i * 2)));
  const errors = new Set<string>();
  const quotes = new Map<string, string>();
  const source = {
    list: vi.fn(() => [...data]),
    file: (key: string) => data.has(key) ? { stat: { ctime: 1, mtime: 1, size: key.length } } as TFile : null,
    readPost: vi.fn(async (key: string) => {
      if (errors.has(key)) throw Error('Unreadable');
      return data.has(key) ? { text: key, quoteId: quotes.get(key) } : null;
    }),
  };
  return { feed: new Feed(source), data, errors, source, quotes };
}

it('inserts sync into loaded history and pages the rest without duplicates (A10)', async () => {
  const { feed, data } = fixture(100);
  await feed.page();
  expect(feed.rows.size).toBe(50);
  const incoming = id(161);
  data.add(incoming);
  await feed.changed(new Set([incoming]));
  expect([...feed.rows.keys()].sort().reverse()[19]).toBe(incoming);
  await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
  expect(feed.more).toBe(false);
  data.add(id(1));
  await feed.changed(new Set([id(1)]));
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
  await feed.changed(new Set(['Murmline']));
  expect(feed.rows.has(id(2))).toBe(true);
  data.clear();
  await feed.changed(new Set(['Murmline']));
  expect(feed.rows.size).toBe(0);
});

it('loads 10,000 records on demand and accepts record 10,001', async () => {
  const { feed, source, data } = fixture(10_000);
  await feed.page();
  expect(source.readPost).toHaveBeenCalledTimes(50);
  while (feed.more) await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
  data.add(id(20_000));
  await feed.changed(new Set([id(20_000)]));
  expect(feed.rows.size).toBe(10_001);
});

it.each(['folder', 'files'])('paginates a 10,000-post %s import into an open empty timeline', async event => {
  const { feed, source, data } = fixture(0);
  await feed.page();
  for (let n = 0; n < 10_000; n++) data.add(id(n));
  const paths = event === 'folder' ? ['Murmline/2026-11'] : [...data];
  await feed.changed(new Set(paths));
  expect(source.readPost).toHaveBeenCalledTimes(50);
  expect([...feed.rows.keys()]).toEqual([...data].reverse().slice(0, 50));
  expect(feed.more).toBe(true);

  // A separate notification for a file already indexed must not eagerly read it.
  await feed.changed(new Set([id(1)]));
  expect(source.readPost).toHaveBeenCalledTimes(50);
  expect(await feed.page()).toBe(id(9949));
  while (feed.more) await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
  expect(source.readPost).toHaveBeenCalledTimes(10_000);
});

it('fills unread gaps on both sides of previously loaded records after a bulk sync', async () => {
  const { feed, data } = fixture(120);
  await feed.page();
  const paths = new Set<string>();
  for (let n = 1; n < 300; n += 2) {
    data.add(id(n));
    paths.add(id(n));
  }
  await feed.changed(paths);
  expect(feed.rows.size).toBe(100);
  expect(feed.rows.has(id(299))).toBe(true);
  // An indexed but unread file can be removed before pagination reaches it.
  data.delete(id(1));
  await feed.changed(new Set([id(1)]));
  while (feed.more) await feed.page();
  expect(new Set(feed.rows.keys())).toEqual(data);
});

function searchFixture(entries: Array<{ id: string; text: string; quoteId?: string }>) {
  const texts = new Map(entries.map(entry => [entry.id, entry.text]));
  const quotes = new Map(entries.filter(entry => entry.quoteId).map(entry => [entry.id, entry.quoteId!]));
  const data = new Set(texts.keys());
  const errors = new Set<string>();
  const files = new Map<string, TFile>();
  const source = {
    list: vi.fn(() => [...data]),
    file: (key: string) => {
      if (!data.has(key)) return null;
      let file = files.get(key);
      if (!file) {
        file = { path: postPath(key), stat: { ctime: 1, mtime: 1, size: 0 } } as TFile;
        files.set(key, file);
      }
      file.stat.size = texts.get(key)?.length ?? 0;
      return file;
    },
    readPost: vi.fn(async (key: string) => {
      if (errors.has(key)) throw Error('Unreadable');
      return data.has(key) ? { text: texts.get(key)!, quoteId: quotes.get(key) } : null;
    }),
  };
  return { feed: new Feed(source), data, texts, errors, source, quotes };
}

it('searches the whole folder, including records not yet loaded (A18)', async () => {
  const entries = Array.from({ length: 120 }, (_, i) => ({ id: id(i), text: '其它内容' }));
  entries[5]!.text = '海边的 #阅读/笔记';
  const { feed } = searchFixture(entries);
  await feed.page();
  expect(feed.rows.has(id(5))).toBe(false);
  await feed.search('海边');
  expect(feed.rows.has(id(5))).toBe(true);
  await feed.search('#阅读/笔记');
  expect(feed.rows.has(id(5))).toBe(true);
  await feed.search('#阅读');
  expect(feed.rows.has(id(5))).toBe(true);
});

it('pages a large match set 50 at a time with no duplicates or gaps (A22)', async () => {
  const entries = Array.from({ length: 70 }, (_, i) => ({ id: id(i), text: '打卡 #打卡' }));
  const { feed } = searchFixture(entries);
  await feed.search('#打卡');
  expect(feed.rows.size).toBe(50);
  expect(feed.more).toBe(true);
  await feed.page();
  expect(feed.rows.size).toBe(70);
  expect(new Set(feed.rows.keys())).toEqual(new Set(entries.map(entry => entry.id)));
  expect(feed.more).toBe(false);
});

it('syncs matching additions and removals while searching and restores the timeline (A20)', async () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({ id: id(i), text: i < 3 ? '漫步 #散步' : '其它内容' }));
  const { feed, data, texts } = searchFixture(entries);
  await feed.page();
  await feed.search('#散步');
  expect(feed.rows.size).toBe(3);
  const matching = id(100);
  data.add(matching); texts.set(matching, '新想法 #散步');
  await feed.changed(new Set([matching]));
  expect(feed.rows.has(matching)).toBe(true);
  const other = id(101);
  data.add(other); texts.set(other, '无关记录');
  await feed.changed(new Set([other]));
  expect(feed.rows.has(other)).toBe(false);
  await feed.search('');
  expect(feed.rows.has(other)).toBe(true);
});

it('resolves single-level quote snapshots and degrades on deletion or read failure (A15/A24)', async () => {
  const { feed, data, errors } = searchFixture([
    { id: id(0), text: '星河' },
    { id: id(1), text: '同感', quoteId: id(0) },
  ]);
  await feed.page();
  const first = feed.rows.get(id(1))!;
  expect('text' in first && first.quote).toEqual({ id: id(0), status: 'ok', text: '星河' });
  errors.add(id(0));
  await feed.reload(id(1));
  const failed = feed.rows.get(id(1))!;
  expect('text' in failed && failed.quote?.status).toBe('error');
  errors.clear();
  await feed.retryQuote(id(1));
  const recovered = feed.rows.get(id(1))!;
  expect('text' in recovered && recovered.quote?.status).toBe('ok');
  data.delete(id(0));
  await feed.changed(new Set([id(0)]));
  const missing = feed.rows.get(id(1))!;
  expect('text' in missing && missing.quote?.status).toBe('missing');
});

it('never matches a record through its quote card (A23)', async () => {
  const { feed } = searchFixture([
    { id: id(0), text: '星河' },
    { id: id(1), text: '同感', quoteId: id(0) },
  ]);
  await feed.search('星河');
  expect(feed.rows.has(id(0))).toBe(true);
  expect(feed.rows.has(id(1))).toBe(false);
});

it('keeps the search window on a folder-wide sync instead of loading every match (P1)', async () => {
  const entries = Array.from({ length: 300 }, (_, i) => ({ id: id(i), text: '打卡 #打卡' }));
  const { feed, source } = searchFixture(entries);
  await feed.search('#打卡');
  expect(feed.rows.size).toBe(50);
  const before = source.readPost.mock.calls.length;
  await feed.changed(new Set(['Murmline/2026-11']));
  expect(feed.rows.size).toBe(50);
  expect(feed.more).toBe(true);
  expect(source.readPost.mock.calls.length - before).toBeLessThanOrEqual(60);
});

it('ignores a page load requested by a stale search session (P2)', async () => {
  const entries = Array.from({ length: 120 }, (_, i) => ({ id: id(i), text: '打卡 #打卡' }));
  const { feed } = searchFixture(entries);
  const first = feed.begin('#打卡');
  const second = feed.begin('打卡');
  await feed.page(() => true, first.token);
  expect(feed.rows.size).toBe(0);
  await feed.page(() => true, second.token);
  expect(feed.rows.size).toBe(50);
});

it('drops a quote retry that resolves after the search changed (P2)', async () => {
  const { feed } = searchFixture([
    { id: id(0), text: '星河' },
    { id: id(1), text: '同感', quoteId: id(0) },
  ]);
  await feed.search('同感');
  expect(feed.rows.has(id(1))).toBe(true);
  const pending = feed.retryQuote(id(1));
  await feed.search('星河');
  await pending;
  expect(feed.rows.has(id(1))).toBe(false);
  expect(feed.rows.has(id(0))).toBe(true);
});

it('leaves the previous view when listing fails so a retry runs the query (P2)', async () => {
  const entries = Array.from({ length: 3 }, (_, i) => ({ id: id(i), text: '打卡' }));
  const { feed, source } = searchFixture(entries);
  source.list.mockImplementationOnce(() => { throw Error('Unavailable'); });
  await expect(feed.search('打卡')).rejects.toThrow();
  expect(feed.searching).toBe(false);
  await feed.search('打卡');
  expect(feed.searching).toBe(true);
  expect(feed.rows.size).toBe(3);
});

it('treats a quote target with a corrupt marker as unavailable, not a read failure (P2)', async () => {
  const { feed, source, data, texts, quotes } = searchFixture([
    { id: id(0), text: '星河' },
    { id: id(1), text: '同感', quoteId: id(0) },
  ]);
  source.readPost.mockImplementation(async (key: string) => {
    if (key === id(0)) throw new PostError('invalid', 'x');
    return data.has(key) ? { text: texts.get(key)!, quoteId: quotes.get(key) } : null;
  });
  await feed.page();
  const row = feed.rows.get(id(1))!;
  expect('text' in row && row.quote?.status).toBe('missing');
});

it('returns the first newly added match when a search page loads (P3)', async () => {
  const entries = Array.from({ length: 70 }, (_, i) => ({ id: id(i), text: '打卡 #打卡' }));
  const { feed } = searchFixture(entries);
  const session = feed.begin('#打卡');
  expect(await feed.page(() => true, session.token)).toBe(id(69));
  expect(feed.rows.size).toBe(50);
  expect(await feed.page(() => true, session.token)).toBe(id(19));
  expect(feed.rows.size).toBe(70);
});

it.each(['folder', 'files'])('keeps the active search page bounded across a %s import', async event => {
  const { feed, data, texts, source } = searchFixture([{ id: id(0), text: 'unrelated' }]);
  await feed.search('#sync');
  const paths = new Set<string>();
  for (let i = 1; i <= 9999; i++) {
    data.add(id(i));
    texts.set(id(i), '#sync');
    paths.add(id(i));
  }
  source.readPost.mockClear();
  await feed.changed(event === 'files' ? paths : new Set(['Murmline/2026-11']));
  expect([...feed.rows.keys()]).toEqual(Array.from({ length: 50 }, (_, i) => id(9999 - i)));
  expect(source.readPost).toHaveBeenCalledTimes(50);

  texts.set(id(9999), 'no longer matches');
  await feed.changed(new Set(['Murmline/2026-11']));
  expect(feed.rows.has(id(9999))).toBe(false);
  expect(feed.rows.has(id(9949))).toBe(true);
  expect(feed.rows.size).toBe(50);
  const newest = id(10000);
  data.add(newest);
  texts.set(newest, '#sync');
  await feed.changed(new Set([newest]));
  expect(feed.rows.has(newest)).toBe(true);
  expect(feed.rows.size).toBe(50);
  expect(await feed.page()).toBe(id(9949));
  expect(feed.rows.size).toBe(100);
});

it('stops a cached zero-match scan when the next event-loop turn clears the query', async () => {
  const entries = Array.from({ length: 10000 }, (_, n) => ({ id: id(n), text: 'unrelated' }));
  const { feed, source } = searchFixture(entries);
  const cancel = new Promise<void>(resolve => setTimeout(() => { feed.begin(''); resolve(); }, 0));
  await Promise.all([feed.search('absent'), cancel]);
  expect(source.readPost.mock.calls.length).toBeGreaterThan(0);
  expect(source.readPost.mock.calls.length).toBeLessThanOrEqual(40);
  expect(feed.searching).toBe(false);
});

it('updates a deep search window in place and skips unchanged folder contents', async () => {
  const entries = Array.from({ length: 10000 }, (_, i) => ({ id: id(i), text: '#match' }));
  const { feed, texts, source } = searchFixture(entries);
  await feed.page();
  await feed.search('#match');
  for (let page = 1; page < 10; page++) await feed.page();
  const window = feed.rows;
  const unaffected = window.get(id(9998));
  source.readPost.mockClear();
  await feed.changed(new Set(['Murmline/2026-11']));
  expect(source.readPost).not.toHaveBeenCalled();
  texts.set(id(9999), '#match edited');
  await feed.changed(new Set([id(9999)]));
  expect(source.readPost.mock.calls).toEqual([[id(9999)], [id(9999)]]);
  expect(feed.rows).toBe(window);
  expect(window.get(id(9998))).toBe(unaffected);
  expect(window.get(id(9999))).toHaveProperty('text', '#match edited');
  expect(window.size).toBe(500);
});

it('detects same-size folder edits to a scanned miss and to a visible quote target', async () => {
  const { feed, source, texts } = searchFixture([
    { id: id(0), text: 'miss' },
    { id: id(1), text: 'find reply', quoteId: id(0) },
  ]);
  await feed.search('find');
  source.readPost.mockClear();
  await feed.changed(new Set(['Murmline']));
  expect(source.readPost).not.toHaveBeenCalled();
  texts.set(id(0), 'find');
  source.file(id(0))!.stat.mtime++;
  await feed.changed(new Set(['Murmline/2026-11']));
  expect(feed.rows.get(id(0))).toHaveProperty('text', 'find');
  expect(feed.rows.get(id(1))).toHaveProperty('quote.text', 'find');
  expect(source.readPost.mock.calls.every(([key]) => key === id(0))).toBe(true);
});
