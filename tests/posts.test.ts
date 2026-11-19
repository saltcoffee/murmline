import { afterEach, describe, expect, it, vi } from 'vitest';
import { language } from '../src/i18n';
import {
  dayKey, dayLabel, draft, inspect, isPostId, localTime, matchesQuery, parseHeader, parseQuery, pathId,
  postPath, serialize, slugify, tokenizeBody,
} from '../src/post';

describe('140 visible characters', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it.each([true, false])('uses grapheme boundaries (native Segmenter available: %s)', async native => {
    if (!native) vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    vi.resetModules();
    const { inspect } = await import('../src/post');
    expect(inspect('好'.repeat(139) + '👨‍👩‍👧‍👦')).toMatchObject({ count: 140, valid: true });
    expect(inspect('好'.repeat(139) + '👨‍👩‍👧‍👦！')).toMatchObject({ count: 141, valid: false });
    expect(inspect('🇨🇳e\u0301')).toMatchObject({ count: 2, valid: true });
    expect(inspect('  \r\n')).toEqual({ text: '  \n', count: 3, valid: false });
    expect(inspect(' A\rB ')).toEqual({ text: ' A\nB ', count: 5, valid: true });
  });
});

it('round-trips only canonical paths for this UTC month and timestamp', () => {
  const post = draft(inspect(' hello ').text);
  expect(pathId(postPath(post.id))).toBe(post.id);
  expect(pathId(postPath(post.id).replace(/\/\d{4}-\d{2}\//, '/2000-01/'))).toBeNull();
  expect(pathId('Another/' + postPath(post.id))).toBeNull();
  expect(pathId(postPath(post.id) + 'x')).toBeNull();
  expect(() => postPath('../note')).toThrow();
});

describe('content-derived file names', () => {
  it('names a new post after its text with the millisecond stamp first', () => {
    const post = draft('今天天气真不错，但是周老师不理我。');
    expect(post.id).toMatch(/^\d{13}_今天天气真不错/);
    expect(pathId(postPath(post.id))).toBe(post.id);
    expect(isPostId(post.id)).toBe(true);
  });

  it('strips path/link characters and bounds the slug length', () => {
    const post = draft('a/b\\c:d*e?f"g<h>i|j#k^l[m]n '.repeat(5));
    const forbidden = '\\/:*?"<>|#^[]';
    for (const char of post.id.slice(14)) expect(forbidden.includes(char)).toBe(false);
    expect([...post.id.slice(14)].length).toBeLessThanOrEqual(20);
    expect([...post.id.slice(14)].length).toBeGreaterThan(0);
  });

  it('falls back to a stable slug and keeps legacy UUID ids valid', () => {
    expect(slugify('###  ')).toBe('post');
    expect(isPostId('1794969720000_9ff8b1a2-7f60-4d65-9a5d-4485b82f80d')).toBe(true);
    expect(isPostId('1794969720000_bad/id')).toBe(false);
  });
});

it('selects the host language for both commands and feedback', () => {
  for (const code of ['zh', 'zh-CN', 'zh_TW']) expect(language(code).t.capture).toBe('记录想法');
  for (const code of ['en', 'de', '']) expect(language(code).t.capture).toBe('Capture a thought');
  expect(language('zh').t.over(2)).toBe('已超出 2 字');
  expect(language('en').t.over(1)).toBe('1 character over the limit');
});

it('groups A12 by the device calendar and labels yesterday across years', () => {
  const dates = ['2026-11-17T16:05Z', '2026-11-17T15:55Z'].map(s => new Date(s));
  try {
    for (const zone of ['UTC', 'Asia/Shanghai', 'UTC']) {
      vi.stubEnv('TZ', zone);
      expect(dates.map(localTime)).toEqual(zone === 'UTC' ? ['16:05', '15:55'] : ['00:05', '23:55']);
      expect(new Set(dates.map(dayKey)).size).toBe(zone === 'UTC' ? 1 : 2);
    }
    const label = dayLabel(new Date(2025, 11, 31), new Date(2026, 0, 1), language('zh'));
    expect(label).toMatch(/昨天.*2025/);
  } finally { vi.unstubAllEnvs(); }
});

describe('tag tokens and search', () => {
  it('renders only valid tags and preserves the rest as text (A19)', () => {
    const source = 'https://a.com#top #2026 散步，#灵感 （#日常/晨间）';
    const tokens = tokenizeBody(source);
    expect(tokens.filter(token => token.type === 'tag').map(token => token.value)).toEqual(['#灵感', '#日常/晨间']);
    expect(tokens.map(token => token.value).join('')).toBe(source);
  });

  it('rejects all-digit, slash-edged and doubled-slash bodies', () => {
    expect(tokenizeBody('#123 #a/ /b #c//d').filter(token => token.type === 'tag')).toEqual([]);
    expect(tokenizeBody('读书/摘录 #读书/摘录').filter(token => token.type === 'tag').map(token => token.value))
      .toEqual(['#读书/摘录']);
  });

  it('parses AND queries and matches nested parent tags (A18)', () => {
    const query = parseQuery('海边 #阅读');
    expect(query).toEqual({ tags: ['#阅读'], texts: ['海边'] });
    expect(matchesQuery('海边的 #阅读/笔记', query!)).toBe(true);
    expect(matchesQuery('山里的 #阅读', query!)).toBe(false);
    expect(parseQuery('   ')).toBeNull();
    expect(matchesQuery('#阅读', parseQuery('#阅读')!)).toBe(true);
    expect(matchesQuery('#阅读/摘录', parseQuery('#阅读')!)).toBe(true);
    expect(matchesQuery('#阅读笔记', parseQuery('#阅读')!)).toBe(false);
  });

  it('only matches the supplied body, never a quote card (A23)', () => {
    const query = parseQuery('星河')!;
    expect(matchesQuery('同感', query)).toBe(false);
    expect(matchesQuery('星河', query)).toBe(true);
  });
});

it('serializes and parses v1 and v2 headers', () => {
  const target = draft('x');
  expect(serialize('body')).toBe('<!-- murmline:v1 -->\nbody');
  expect(serialize('body', target.id)).toBe(`<!-- murmline:v2 quote:${target.id} -->\nbody`);
  expect(parseHeader('<!-- murmline:v1 -->')).toEqual({ version: 1 });
  expect(parseHeader('<!-- murmur:v1 -->')).toEqual({ version: 1 });
  expect(parseHeader(`<!-- murmline:v2 quote:${target.id} -->`)).toEqual({ version: 2, quoteId: target.id });
  expect(parseHeader('<!-- murmline:v2 -->')).toEqual({ version: 'invalid' });
  expect(parseHeader('<!-- murmline:v2 quote:not-an-id -->')).toEqual({ version: 'invalid' });
  expect(parseHeader('<!-- murmline:v2 quote:2026-11-18 -->')).toEqual({ version: 'invalid' });
  expect(parseHeader('ordinary note')).toBeNull();
});

it('tokenizes and matches astral CJK tags such as #𠮷野家 (P2)', () => {
  const tokens = tokenizeBody('晚饭 #𠮷野家 很好吃');
  expect(tokens.filter(token => token.type === 'tag').map(token => token.value)).toEqual(['#𠮷野家']);
  expect(matchesQuery('晚饭 #𠮷野家 很好吃', parseQuery('#𠮷野家')!)).toBe(true);
});

it('uses just the relative day in quote previews and keeps absolute dates for older posts', () => {
  const now = new Date(2026, 10, 18, 12);
  const zh = language('zh');
  const preview = (date: Date) => zh.t.quoteOf(dayLabel(date, now, zh, 'compact') + ' ' + localTime(date));
  expect(preview(new Date(2026, 10, 18, 8, 5))).toBe('正在引用 · 今天 08:05');
  expect(preview(new Date(2026, 10, 17, 21, 3))).toBe('正在引用 · 昨天 21:03');
  for (const date of [new Date(2026, 10, 12), new Date(2025, 10, 17)]) {
    expect(dayLabel(date, now, zh, 'compact')).toBe(dayLabel(date, now, zh));
  }
  expect(preview(new Date(2025, 10, 17))).toContain('2025');
  expect(dayLabel(new Date(2025, 11, 31), new Date(2026, 0, 1), language('en'), 'compact')).toBe('Yesterday');
});
