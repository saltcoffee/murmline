import { countGraphemes } from 'unicode-segmenter/grapheme';
import type { Language } from './i18n';

export const LIMIT = 140;
export const ROOT = 'Murmline';
export const MARKER = '<!-- murmline:v1 -->';
const LEGACY_MARKER = '<!-- murmur:v1 -->';
const V2_PREFIX = '<!-- murmline:v2';
const ID_SOURCE = '[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const idPattern = new RegExp('^' + ID_SOURCE + '$');
const quoteHeader = new RegExp('^<!-- murmline:v2 quote:(' + ID_SOURCE + ') -->$');
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

export type Post = { id: string; text: string; quoteId?: string };
export function draft(text: string, quoteId?: string): Post {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const uuid = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  const post: Post = { id: Date.now() + '_' + uuid, text };
  if (quoteId) post.quoteId = quoteId;
  return post;
}
export function createdAt(id: string) { return new Date(Number(id.slice(0, 13))); }
export function isPostId(id: string) { return idPattern.test(id); }
export function postPath(id: string) {
  if (!idPattern.test(id)) throw new Error('Invalid post ID');
  return ROOT + '/' + createdAt(id).toISOString().slice(0, 7) + '/' + id + '.md';
}
export function pathId(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const id = name.slice(0, -3);
  return idPattern.test(id) && path === postPath(id) ? id : null;
}

// A header is the first line of a post file. v2 quotes a single earlier record;
// a v2 prefix with a malformed argument is reported as 'invalid' so the caller
// can keep the original file instead of silently ignoring it.
export type Header =
  | { version: 1 }
  | { version: 2; quoteId: string }
  | { version: 'invalid' };

export function parseHeader(header: string): Header | null {
  if (header === MARKER || header === LEGACY_MARKER) return { version: 1 };
  if (!header.startsWith(V2_PREFIX)) return null;
  const match = quoteHeader.exec(header);
  return match ? { version: 2, quoteId: match[1]! } : { version: 'invalid' };
}

export function serialize(text: string, quoteId?: string) {
  return (quoteId ? '<!-- murmline:v2 quote:' + quoteId + ' -->' : MARKER) + '\n' + text;
}

// Tag syntax is shared by rendering and filtering. A tag can only start at the
// string start, after whitespace, or after common CJK/fullwidth punctuation, so
// URL anchors such as https://a.com#top never become tags.
const TAG_CHAR = /[\p{L}\p{N}_/-]/u;
const TAG_RUN = /^[\p{L}\p{N}_/-]+/u;
const ALL_DIGITS = /^\p{N}+$/u;
const TAG_BREAK = new Set('，。！？；：（）【】「」『』、'.split(''));

export function isValidTagBody(body: string) {
  if (!body) return false;
  for (const char of body) if (!TAG_CHAR.test(char)) return false;
  if (ALL_DIGITS.test(body)) return false;
  return !body.startsWith('/') && !body.endsWith('/') && !body.includes('//');
}

export type Token = { type: 'text' | 'tag'; value: string };

export function tokenizeBody(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '#') { i++; continue; }
    const previous = i === 0 ? '' : text[i - 1]!;
    if (!(i === 0 || /\s/u.test(previous) || TAG_BREAK.has(previous))) { i++; continue; }
    // Match the body by code point (via a Unicode regex) so astral CJK
    // characters such as 𠮷 are not split across UTF-16 code units.
    const match = TAG_RUN.exec(text.slice(i + 1));
    const body = match ? match[0] : '';
    const end = i + 1 + body.length;
    if (isValidTagBody(body)) {
      if (i > last) tokens.push({ type: 'text', value: text.slice(last, i) });
      tokens.push({ type: 'tag', value: '#' + body });
      last = end;
      i = end;
    } else i = end > i ? end : i + 1;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

export type ParsedQuery = { tags: string[]; texts: string[] };

export function parseQuery(raw: string): ParsedQuery | null {
  const words = raw.split(/\s+/u).filter(Boolean);
  if (!words.length) return null;
  const tags: string[] = [];
  const texts: string[] = [];
  for (const word of words) {
    if (word.charAt(0) === '#' && isValidTagBody(word.slice(1))) tags.push(word.toLowerCase());
    else texts.push(word.toLowerCase());
  }
  return { tags, texts };
}

export function matchesQuery(text: string, query: ParsedQuery) {
  if (query.tags.length) {
    const tags = new Set<string>();
    for (const token of tokenizeBody(text)) if (token.type === 'tag') tags.add(token.value.toLowerCase());
    for (const want of query.tags) {
      let hit = false;
      for (const tag of tags) if (tag === want || tag.startsWith(want + '/')) { hit = true; break; }
      if (!hit) return false;
    }
  }
  if (query.texts.length) {
    const lower = text.toLowerCase();
    for (const want of query.texts) if (!lower.includes(want)) return false;
  }
  return true;
}

export function dayKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
}
export function localTime(date: Date) {
  return [date.getHours(), date.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
}
export function dayLabel(date: Date, now: Date, { locale, t }: Language, format: 'full' | 'compact' = 'full') {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = dayKey(date);
  const prefix = key === dayKey(now) ? t.today : key === dayKey(yesterday) ? t.yesterday : '';
  if (format === 'compact' && prefix) return prefix;
  const label = date.toLocaleDateString(locale, {
    month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return prefix ? prefix + ' · ' + label : label;
}
