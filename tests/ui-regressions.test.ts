import type { TFile, WorkspaceLeaf } from 'obsidian';
import { afterEach, expect, it, vi } from 'vitest';
import { DeleteModal } from '../src/delete-modal';
import { language } from '../src/i18n';
import type { PostStore } from '../src/post-store';
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
    file: () => target, read: async () => 'test',
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
    file: () => target, read: async () => 'test',
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
  const store = { list: () => keys, read: vi.fn(async (id: string) => id) };
  const view = new TimelineView({} as WorkspaceLeaf, store as unknown as PostStore, lang);
  await view.onOpen();
  const root = view.contentEl as unknown as TestElement;
  const readyKey = keys.at(-1)!;
  await vi.waitFor(() => expect(root.find(el => el.dataset.id === readyKey)).toBeDefined());
  return { view, root, store, keys, older: root.find(el => el.cls === 'murmline-older')! };
}

it.each([51, 101])('keeps keyboard focus through pagination with %i posts', async size => {
  const {root, store, keys, older} = await timeline(size);
  const gate = deferred<string>();
  store.read.mockImplementationOnce(() => gate.promise);
  older.focus();
  older.click();
  older.click();
  expect(older.hidden).toBe(false);
  expect(older.attributes.get('aria-disabled')).toBe('true');
  expect(root.ownerDocument.activeElement).toBe(older);
  const next = keys[size - 51]!;
  gate.resolve(next);
  await vi.waitFor(() => {
    const action = root.find(el => el.dataset.id === next)?.find(el => el.cls.includes('murmline-action'));
    expect(action).toBeDefined();
    expect(root.ownerDocument.activeElement).toBe(action);
  });
  expect(older.hidden).toBe(size === 51);
  expect(store.read).toHaveBeenCalledTimes(Math.min(size, 100));
});

it('preserves focus moved elsewhere during a keyboard page read', async () => {
  const {root, store, keys, older} = await timeline(51);
  const gate = deferred<string>();
  store.read.mockImplementationOnce(() => gate.promise);
  older.focus();
  older.click();
  const other = root.find(el => el.attributes.has('placeholder'))!;
  other.focus();
  gate.resolve(keys[0]!);
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
