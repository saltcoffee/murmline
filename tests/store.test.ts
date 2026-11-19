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

  it('reads an original Murmur post moved into the Murmline folder', async () => {
    const { store, contents } = fixture();
    const post = draft('first thought');
    await store.publish(post);
    contents.set(postPath(post.id), '<!-- murmur:v1 -->\r\nfirst thought');
    expect(store.list()).toEqual([post.id]);
    expect(await store.read(post.id)).toBe(post.text);
  });

  it('writes and reads a quoted v2 record and rejects malformed v2 headers', async () => {
    const { store, contents } = fixture();
    const target = draft('original');
    await store.publish(target);
    const reply = draft('reply', target.id);
    await store.publish(reply);
    expect(contents.get(postPath(reply.id))).toBe(`<!-- murmline:v2 quote:${target.id} -->\nreply`);
    expect(await store.readPost(reply.id)).toEqual({ text: 'reply', quoteId: target.id });
    expect(await store.readPost(target.id)).toEqual({ text: 'original' });
    expect(await store.read(reply.id)).toBe('reply');
    // Self-reference and malformed arguments are invalid but keep the file.
    contents.set(postPath(reply.id), `<!-- murmline:v2 quote:${reply.id} -->\nreply`);
    await expect(store.readPost(reply.id)).rejects.toMatchObject({ reason: 'invalid' });
    contents.set(postPath(reply.id), '<!-- murmline:v2 quote:bad -->\nreply');
    await expect(store.readPost(reply.id)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('keeps occupied directories and conflicting contents intact', async () => {
    const { store, files, contents } = fixture();
    const post = draft('one');
    files.set('Murmline', new TFile('Murmline'));
    await expect(store.publish(post)).rejects.toMatchObject({ reason: 'occupied', path: 'Murmline' });
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
    contents.set(path, 'ordinary note');
    expect(await remove()).toBe('gone');
    // A v2 prefix with a malformed argument is reported as invalid rather than ignored.
    contents.set(path, '<!-- murmline:v2 -->\nnew');
    await expect(remove()).rejects.toMatchObject({ reason: 'invalid' });
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
