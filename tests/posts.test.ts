import { afterEach, describe, expect, it, vi } from 'vitest';
import { language } from '../src/i18n';
import { dayKey, dayLabel, draft, inspect, localTime, pathId, postPath } from '../src/post';

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

it('round-trips only canonical paths for this UTC month and UUID', () => {
  const post = draft(inspect(' hello ').text);
  expect(pathId(postPath(post.id))).toBe(post.id);
  expect(pathId(postPath(post.id).replace(/\/\d{4}-\d{2}\//, '/2000-01/'))).toBeNull();
  expect(pathId('Another/' + postPath(post.id))).toBeNull();
  expect(pathId(postPath(post.id) + 'x')).toBeNull();
  expect(() => postPath('../note')).toThrow();
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
