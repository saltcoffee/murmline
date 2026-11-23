import type { TFile, WorkspaceLeaf } from 'obsidian';
import { afterEach, expect, it, vi } from 'vitest';
import { DeleteModal } from '../src/delete-modal';
import { language } from '../src/i18n';
import { PostError, type PostStore } from '../src/post-store';
import { postPath } from '../src/post';
import { TimelineView } from '../src/timeline-view';
import { TestElement } from './ui-fixture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const key = (time: number) => time + '_00000000-0000-4000-8000-000000000000';
const start = Date.parse('2026-11-17T16:05:00Z');
const lang = language('en');
afterEach(() => vi.unstubAllEnvs());

it('allows dismissal during the final read, before deletion starts', async () => {
  const preflight = deferred<void>();
  const trash = vi.fn();
  const target = {} as TFile;
  const store = {
    file: () => target, readPost: async () => ({ text: 'test' }),
    remove: async (_post: unknown, _file: TFile, current: () => boolean, commit: () => void) => {
      await preflight.promise;
      if (!current()) return 'stale';
      commit();
      trash();
      return 'deleted';
    },
  };
  const finished = vi.fn();
  const modal = new DeleteModal(store as unknown as PostStore, lang, {id: key(start), text: 'test'}, target, finished);
  modal.onOpen();
  const root = modal.contentEl as unknown as TestElement;
  const confirm = root.find(el => el.textContent === lang.t.remove)!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  confirm.click();
  root.find(el => el.textContent === lang.t.cancel)!.click();
  preflight.resolve();
  await preflight.promise;
  expect(trash).not.toHaveBeenCalled();
  expect(finished).toHaveBeenCalledExactlyOnceWith(false);
});

it.each(['success', 'failure'])('locks dismissal while trash is pending, then handles %s', async outcome => {
  const write = deferred<void>();
  const target = {} as TFile;
  const store = {
    file: () => target, readPost: async () => ({ text: 'test' }),
    remove: vi.fn(async (_post, _file, _current, commit) => {
      commit();
      await write.promise;
      return 'deleted';
    }),
  };
  const finished = vi.fn();
  const modal = new DeleteModal(store as unknown as PostStore, lang, {id: key(start), text: 'test'}, target, finished);
  modal.onOpen();
  const root = modal.contentEl as unknown as TestElement;
  const cancel = root.find(el => el.textContent === lang.t.cancel)!;
  const confirm = root.find(el => el.textContent === lang.t.remove)!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  confirm.click();
  expect(cancel.disabled).toBe(true);
  expect(root.find(el => el.textContent === lang.t.deleting)).toBeDefined();
  cancel.click();
  modal.close(); // Esc, backdrop and close button all request close.
  expect(finished).not.toHaveBeenCalled();
  if (outcome === 'success') {
    write.resolve();
    await vi.waitFor(() => expect(finished).toHaveBeenCalledWith(true));
  } else {
    write.reject(new Error('Disk unavailable'));
    await vi.waitFor(() => expect(cancel.disabled).toBe(false));
    expect(confirm.disabled).toBe(false);
    cancel.click();
    expect(finished).toHaveBeenCalledWith(false);
  }
  expect(finished).toHaveBeenCalledTimes(1);
});

async function timeline(size: number) {
  const keys = Array.from({length: size}, (_, i) => key(start + i));
  const store = { list: () => keys, file: () => ({ stat: { mtime: 1, size: 1 } }), readPost: vi.fn(async (id: string) => ({ text: id })) };
  const view = new TimelineView({} as WorkspaceLeaf, store as unknown as PostStore, lang);
  await view.onOpen();
  const root = view.contentEl as unknown as TestElement;
  const readyKey = keys.at(-1)!;
  await vi.waitFor(() => expect(root.find(el => el.dataset.id === readyKey)).toBeDefined());
  return { view, root, store, keys, older: root.find(el => el.cls === 'murmline-older')! };
}

it('keeps input hints and accessible names without host hover tooltips', async () => {
  const { root } = await timeline(1);
  for (const hint of [lang.t.placeholder, lang.t.searchPlaceholder]) {
    const field = root.find(el => el.attributes.get('placeholder') === hint)!;
    const id = field.attributes.get('id');
    expect(id).toBeTruthy();
    expect(root.find(el => el.attributes.get('for') === id)?.textContent).toBeTruthy();
    expect(field.attributes.has('aria-label')).toBe(false);
    expect(field.attributes.has('title')).toBe(false);
  }
});

it.each([51, 101])('keeps keyboard focus through pagination with %i posts', async size => {
  const {root, store, keys, older} = await timeline(size);
  const gate = deferred<{ text: string }>();
  store.readPost.mockImplementationOnce(() => gate.promise);
  older.focus();
  older.click();
  older.click();
  expect(older.hidden).toBe(false);
  expect(older.attributes.get('aria-disabled')).toBe('true');
  expect(root.ownerDocument.activeElement).toBe(older);
  const next = keys[size - 51]!;
  gate.resolve({ text: next });
  await vi.waitFor(() => {
    const action = root.find(el => el.dataset.id === next)?.find(el => el.cls.includes('murmline-action'));
    expect(action).toBeDefined();
    expect(root.ownerDocument.activeElement).toBe(action);
  });
  expect(older.hidden).toBe(size === 51);
  expect(store.readPost).toHaveBeenCalledTimes(Math.min(size, 100));
});

it('preserves focus moved elsewhere during a keyboard page read', async () => {
  const {root, store, keys, older} = await timeline(51);
  const gate = deferred<{ text: string }>();
  store.readPost.mockImplementationOnce(() => gate.promise);
  older.focus();
  older.click();
  const other = root.find(el => el.attributes.has('placeholder'))!;
  other.focus();
  gate.resolve({ text: keys[0]! });
  await vi.waitFor(() => expect(older.hidden).toBe(true));
  expect(root.ownerDocument.activeElement).toBe(other);
});

it('refreshes the visible time and accessible action name on the same cached row', async () => {
  vi.stubEnv('TZ', 'UTC');
  const {view, root} = await timeline(1);
  const action = root.find(el => el.cls.includes('murmline-action'))!;
  for (const [zone, time] of [['Asia/Shanghai', '00:05'], ['UTC', '16:05']] as const) {
    vi.stubEnv('TZ', zone);
    view['checkClock']();
    expect(action.attributes.get('aria-label')).toBe('More · ' + time);
    expect(root.find(el => el.textContent === time)).toBeDefined();
  }
});

it('renders quote cards and clickable tags, and lazily reveals the search bar', async () => {
  const a = key(start);
  const b = key(start + 1);
  const data: Record<string, { text: string; quoteId?: string }> = {
    [a]: { text: '原想法' },
    [b]: { text: '回复 #标签', quoteId: a },
  };
  const store = { list: () => [a, b], file: () => ({ stat: { mtime: 1, size: 1 } }), readPost: vi.fn(async (id: string) => data[id] ?? null) };
  const view = new TimelineView({} as WorkspaceLeaf, store as unknown as PostStore, lang);
  await view.onOpen();
  const root = view.contentEl as unknown as TestElement;
  await vi.waitFor(() => expect(root.find(el => el.cls === 'murmline-quote')).toBeDefined());
  const quoteText = root.find(el => el.cls === 'murmline-quote-text');
  expect(quoteText?.textContent).toBe('原想法');
  const tag = root.find(el => el.cls === 'murmline-tag');
  expect(tag?.textContent).toBe('#标签');
  const search = root.find(el => el.cls === 'murmline-search')!;
  expect(search.hidden).toBe(false);
});

it('cancels a pending debounce when a filter is applied immediately (P1)', async () => {
  const { view } = await timeline(2);
  const v = view as unknown as {
    searchInput: TestElement; searchTimer?: number;
    scheduleSearch: (immediate: boolean) => void; applySearch: (value: string) => void;
  };
  v.searchInput.value = 'alpha';
  v.scheduleSearch(false);
  expect(v.searchTimer).toBeDefined();
  v.applySearch('');
  expect(v.searchTimer).toBeUndefined();
});

it('recovers a missing quote preview when the target returns (P2)', async () => {
  const a = key(start);
  const store = {
    list: () => [a],
    file: (id: string) => id === a ? ({ stat: { ctime: 1, mtime: 1, size: 1 } } as TFile) : null,
    readPost: vi.fn(async (id: string) => id === a ? { text: '原想法' } : null),
  };
  const view = new TimelineView({} as WorkspaceLeaf, store as unknown as PostStore, lang);
  await view.onOpen();
  const v = view as unknown as {
    quoting?: { id: string; text: string; missing?: boolean };
    startQuote: (post: { id: string; text: string }) => void;
    quoteChanged: (path: string, moved: boolean) => void;
  };
  v.startQuote({ id: a, text: '原想法' });
  v.quoteChanged(postPath(a), true);
  expect(v.quoting?.missing).toBe(true);
  v.quoteChanged(postPath(a), false);
  await vi.waitFor(() => expect(v.quoting?.missing).toBe(false));
});

it('discards a queued timeline page when a search starts before it runs', async () => {
  const { view, older } = await timeline(160);
  older.click();
  view['applySearch']('00000000');
  await view['serial'];
  expect(view['feed'].rows.size).toBe(50);
  expect(view['feed'].more).toBe(true);
});

it('keeps the newest draft preview through out-of-order reads, invalid markers and moves', async () => {
  const { view, store, keys } = await timeline(1);
  const id = keys[0]!;
  Object.assign(store, { file: () => ({}) });
  view['startQuote']({ id, text: 'original' });
  const slow = deferred<{ text: string }>();
  store.readPost.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce({ text: 'latest' });
  view['quoteChanged'](postPath(id), false);
  view['quoteChanged'](postPath(id), false);
  await vi.waitFor(() => expect(view['quoting']?.text).toBe('latest'));
  slow.resolve({ text: 'older' });
  await slow.promise;
  expect(view['quoting']?.text).toBe('latest');

  store.readPost.mockRejectedValueOnce(new PostError('invalid', postPath(id)));
  view['quoteChanged'](postPath(id), false);
  await vi.waitFor(() => expect(view['quoting']?.missing).toBe(true));
  const moved = deferred<{ text: string }>();
  store.readPost.mockImplementationOnce(() => moved.promise);
  view['quoteChanged'](postPath(id), false);
  view['quoteChanged'](postPath(id), true);
  moved.resolve({ text: 'restored too late' });
  await moved.promise;
  expect(view['quoting']?.missing).toBe(true);
});

it('stacks quote preview label and text inside a dedicated body wrapper', async () => {
  const { view, root, keys } = await timeline(1);
  view['startQuote']({ id: keys[0]!, text: 'preview text' });
  const bar = root.find(el => el.cls === 'murmline-quote-bar')!;
  const body = bar.children.find(el => el.cls === 'murmline-quote-bar-body');
  expect(body).toBeDefined();
  expect(body?.find(el => el.cls === 'murmline-quote-bar-label')).toBeDefined();
  expect(body?.find(el => el.cls === 'murmline-quote-bar-text')?.textContent).toBe('preview text');
  expect(bar.children.some(el => el.cls.includes('murmline-quote-cancel'))).toBe(true);
});

it('hides the earlier button while initial search is loading and preserves search page on retry', async () => {
  const { view, root, store, older } = await timeline(120);
  const gate = deferred<{ text: string }>();
  store.readPost.mockImplementationOnce(() => gate.promise);
  const v = view as unknown as {
    searchInput: TestElement;
    applySearch: (value: string) => void;
    olderAction: (keyboard: boolean) => void;
    pageError: string;
    render: () => void;
  };
  v.searchInput.value = '00000000';
  v.applySearch('00000000');
  expect(older.hidden).toBe(true);
  older.click();
  gate.resolve({ text: '00000000' });
  await view['serial'];
  expect(view['feed'].rows.size).toBe(50);
  expect(older.hidden).toBe(false);

  // When a page error occurs during active search, retry advances the page rather than resetting to page 1.
  v.pageError = lang.t.loadError;
  v.render();
  v.olderAction(false);
  await view['serial'];
  expect(view['feed'].rows.size).toBe(100);

  // When a search has 0 results and a page error, do not show the contradictory "No matching thoughts." status.
  v.searchInput.value = 'absent';
  v.applySearch('absent');
  await view['serial'];
  expect(view['feed'].rows.size).toBe(0);
  const searchStatus = root.find(el => el.cls === 'murmline-search-status')!;
  expect(searchStatus.textContent).toBe(lang.t.noResults);
  v.pageError = lang.t.loadError;
  v.render();
  expect(searchStatus.textContent).toBe('');

  // When switching from an active search to a new query fails in begin(), retry runs the new query.
  const list = vi.spyOn(store, 'list');
  list.mockImplementationOnce(() => { throw new Error('Unavailable'); });
  v.searchInput.value = '00000000';
  v.applySearch('00000000');
  expect(view['feed'].searching).toBe(true);
  expect(view['feed'].rows.size).toBe(0);
  v.olderAction(false);
  await view['serial'];
  expect(view['feed'].rows.size).toBe(50);
});

it('refreshes quote card timestamps when the clock changes, toggles tags case-insensitively, and resets composing on focusout', async () => {
  vi.stubEnv('TZ', 'UTC');
  const a = key(start);
  const b = key(start + 1);
  const data: Record<string, { text: string; quoteId?: string }> = {
    [a]: { text: 'origin #Todo' },
    [b]: { text: 'reply #todo', quoteId: a },
  };
  const store = { list: () => [a, b], file: () => ({ stat: { mtime: 1, size: 1 } }), readPost: vi.fn(async (id: string) => data[id] ?? null) };
  const view = new TimelineView({} as WorkspaceLeaf, store as unknown as PostStore, lang);
  await view.onOpen();
  const root = view.contentEl as unknown as TestElement;
  await vi.waitFor(() => expect(root.find(el => el.cls === 'murmline-quote-meta')).toBeDefined());
  const quoteMeta = root.find(el => el.cls === 'murmline-quote-meta')!;
  expect(quoteMeta.textContent).toContain('16:05');

  vi.stubEnv('TZ', 'Asia/Shanghai');
  view['checkClock']();
  expect(quoteMeta.textContent).toContain('00:05');

  // Toggle tag case-insensitively, and ignore clicks when text inside the tag is actively selected.
  const tag = root.find(el => el.cls === 'murmline-tag')!;
  const win = root.ownerDocument.defaultView as unknown as {
    getSelection?: () => { isCollapsed: boolean; toString: () => string; anchorNode: unknown; focusNode: unknown };
  };
  win.getSelection = () => ({ isCollapsed: false, toString: () => '#todo', anchorNode: tag, focusNode: tag });
  tag.click();
  expect(view['searchInput'].value).toBe('');
  win.getSelection = undefined;
  view['toggleTag']('#Todo');
  expect(view['searchInput'].value).toBe('#Todo');
  view['toggleTag']('#todo');
  expect(view['searchInput'].value).toBe('');

  // Clear stuck composing state on focusout.
  const events = (view as unknown as { domEvents: Array<{ type: string; handler: () => void }> }).domEvents;
  events.find(e => e.type === 'compositionstart')?.handler();
  expect(view['composing']).toBe(true);
  events.find(e => e.type === 'focusout')?.handler();
  expect(view['composing']).toBe(false);

  // Repeated reveal cancels the previous highlight timer instead of leaking/racing.
  const cleared: number[] = [];
  let nextTimer = 10;
  root.ownerDocument.defaultView.setTimeout = () => ++nextTimer;
  root.ownerDocument.defaultView.clearTimeout = (id?: number) => { if (id !== undefined) cleared.push(id); };
  view['list'].reveal(a);
  view['list'].reveal(a);
  expect(cleared).toEqual([11]);
  await view.onClose();
  expect(cleared).toEqual([11, 12]);
});
