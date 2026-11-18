import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { draft, MARKER, postPath } from '../src/post';
import { PostStore } from '../src/post-store';
import { Entry, TFile, TFolder } from './obsidian';

function fixture() {
  const files = new Map<string, Entry>();
  const contents = new Map<string, string>();
  function put<T extends Entry>(file: T) {
    if (files.has(file.path)) throw Error('Exists');
    files.set(file.path, file);
    const parent = files.get(file.path.slice(0, file.path.lastIndexOf('/')));
    if (parent instanceof TFolder) parent.children.push(file);
    return file;
  }
  const read = vi.fn(async (file: TFile) => {
    if (!contents.has(file.path)) throw Error('Missing');
    return contents.get(file.path)!;
  });
  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path),
    createFolder: async (path: string) => put(new TFolder(path)),
    create: vi.fn(async (path: string, text: string) => {
      const file = put(new TFile(path));
      contents.set(path, text);
      return file;
    }),
    read, cachedRead: read,
  };
  const trashFile = vi.fn(async (file: TFile) => { files.delete(file.path); contents.delete(file.path); });
  const app = { vault, fileManager: { trashFile } } as unknown as App;
  return { store: new PostStore(app), vault, files, contents, trashFile };
}

describe('vault boundary', () => {
  it('recovers an uncertain create without duplicating and preserves whitespace', async () => {
    const { store, vault, contents } = fixture();
    const post = draft(' hi\n');
    const create = vault.create.getMockImplementation()!;
    vault.create.mockImplementationOnce(async (path, text) => { await create(path, text); throw Error('Interrupted'); });
    await store.publish(post);
    await store.publish(post);
    expect(store.list()).toEqual([post.id]);
    expect(await store.read(post.id)).toBe(post.text);
    expect(contents.get(postPath(post.id))).toBe(MARKER + '\n hi\n');
    await store.publish(draft(post.text));
    expect(store.list()).toHaveLength(2);
  });

  it('keeps occupied directories and conflicting contents intact', async () => {
    const { store, files, contents } = fixture();
    const post = draft('one');
    files.set('Murmur', new TFile('Murmur'));
    await expect(store.publish(post)).rejects.toMatchObject({ reason: 'occupied', path: 'Murmur' });
    files.clear();
    await store.publish(post);
    await expect(store.publish({ ...post, text: 'two' })).rejects.toMatchObject({ reason: 'occupied' });
    expect(contents.get(postPath(post.id))).toBe(MARKER + '\none');
  });

  it('checks marker, preview, file identity and late invalidation before trash', async () => {
    const { store, vault, contents, files, trashFile } = fixture();
    const post = draft('before');
    await store.publish(post);
    const target = store.file(post.id)!;
    const path = postPath(post.id);
    const remove = (current = () => true) => store.remove(post, target, current, () => {});
    for (const other of ['ordinary note', '<!-- murmur:v2 -->\nnew']) {
      contents.set(path, other);
      expect(await remove()).toBe('gone');
    }
    contents.set(path, MARKER + '\n' + '好'.repeat(141));
    await expect(remove()).rejects.toMatchObject({ reason: 'invalid' });
    contents.set(path, MARKER + '\nafter');
    expect(await remove()).toBe('changed');
    contents.set(path, MARKER + '\nbefore');
    let valid = true;
    vault.read.mockImplementationOnce(async () => { valid = false; return MARKER + '\nbefore'; });
    expect(await remove(() => valid)).toBe('stale');
    files.set(path, new TFile(path));
    expect(await remove()).toBe('gone');
    expect(trashFile).not.toHaveBeenCalled();
    files.set(path, target as unknown as TFile);
    trashFile.mockRejectedValueOnce(Error('Denied'));
    await expect(remove()).rejects.toThrow('Denied');
    expect(await store.read(post.id)).toBe('before');
    expect(await remove()).toBe('deleted');
    expect(store.file(post.id)).toBeNull();
  });
});
