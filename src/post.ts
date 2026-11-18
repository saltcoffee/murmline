import { countGraphemes } from 'unicode-segmenter/grapheme';
import type { Language } from './i18n';

export const LIMIT = 140;
export const ROOT = 'Murmur';
export const MARKER = '<!-- murmur:v1 -->';
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;

export function inspect(raw: string) {
  const text = raw.replace(/\r\n?/g, '\n');
  let count = 0;
  if (segmenter) {
    const segments = segmenter.segment(text)[Symbol.iterator]();
    while (!segments.next().done) count++;
  } else count = countGraphemes(text);
  return { text, count, valid: count <= LIMIT && text.trim().length > 0 };
}

export type Post = { id: string; text: string };
export function draft(text: string): Post {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const uuid = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  return { id: Date.now() + '_' + uuid, text };
}
const idPattern = /^\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function createdAt(id: string) { return new Date(Number(id.slice(0, 13))); }
export function postPath(id: string) {
  if (!idPattern.test(id)) throw new Error('Invalid post ID');
  return ROOT + '/' + createdAt(id).toISOString().slice(0, 7) + '/' + id + '.md';
}
export function pathId(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const id = name.slice(0, -3);
  return idPattern.test(id) && path === postPath(id) ? id : null;
}
export function dayKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
}
export function localTime(date: Date) {
  return [date.getHours(), date.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
}
export function dayLabel(date: Date, now: Date, { locale, t }: Language) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = dayKey(date);
  const prefix = key === dayKey(now) ? t.today : key === dayKey(yesterday) ? t.yesterday : '';
  const label = date.toLocaleDateString(locale, {
    month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return prefix ? prefix + ' · ' + label : label;
}
