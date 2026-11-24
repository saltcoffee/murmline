import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { draft, MARKER, postPath } from '../src/post';
import { PostStore } from '../src/post-store';
import { Entry, getFrontMatterInfo, parseYaml, TFile, TFolder } from './obsidian';

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
    adapter: { exists: vi.fn(async (path: string, _sensitive?: boolean) => files.has(path)) },
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
  const metadataCache = { getFileCache(file: TFile) {
    return { frontmatter: parseYaml(getFrontMatterInfo(contents.get(file.path) ?? '').frontmatter) };
  } };
  const app = { vault, metadataCache, fileManager: { trashFile } } as unknown as App;
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
    expect(contents.get(postPath(post.id))).toBe('---\nmurmline-created: ' + post.id.slice(0, 13) + '\n---\n' + MARKER + '\n hi\n');
    const duplicate = draft(post.text, post.id);
    await store.publish(duplicate);
    expect(postPath(duplicate.id)).toBe(postPath(post.id).replace('.md', ' (2).md'));
    const reopened = new PostStore(store.app);
    expect(reopened.list()).toEqual([post.id, duplicate.id]);
    expect(await reopened.readPost(duplicate.id)).toEqual({ text: post.text, quoteId: post.id });
  });

  it('keeps a pending duplicate at its attempted path after a lost acknowledgement', async () => {
    const { store, vault, files, contents } = fixture();
    const first = draft('你好');
    await store.publish(first);
    const second = draft('你好');
    const create = vault.create.getMockImplementation()!;
    vault.create.mockImplementation(async (path, text) => {
      const file = await create(path, text);
      vault.read.mockRejectedValueOnce(Error('Offline'));
      throw Error('Lost acknowledgement for ' + file.path);
    });
    await expect(store.publish(second)).rejects.toThrow('Offline');
    const retryPath = postPath(second.id);
    expect(retryPath).toMatch(/ \(2\)\.md$/);
    files.delete(postPath(first.id));
    contents.delete(postPath(first.id));
    vault.create.mockImplementation(create);
    await store.publish(second);
    expect([...contents.keys()]).toEqual([retryPath]);
  });

  it('reads an original Murmur post moved into the Murmline folder', async () => {
    const { store, contents } = fixture();
    const post = { id: '1795138832796_first thought', text: 'first thought' };
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
    expect(contents.get(postPath(reply.id))).toContain(`<!-- murmline:v2 quote:${target.id} -->\nreply`);
    expect(await store.readPost(reply.id)).toEqual({ text: 'reply', quoteId: target.id });
    expect(await store.readPost(target.id)).toEqual({ text: 'original' });
    expect(await store.read(reply.id)).toBe('reply');
    // Self-reference and malformed arguments are invalid but keep the file.
    const prefix = contents.get(postPath(reply.id))!.split('<!--')[0];
    contents.set(postPath(reply.id), prefix + `<!-- murmline:v2 quote:${reply.id} -->\nreply`);
    await expect(store.readPost(reply.id)).rejects.toMatchObject({ reason: 'invalid' });
    contents.set(postPath(reply.id), prefix + '<!-- murmline:v2 quote:bad -->\nreply');
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
    expect(contents.get(postPath(post.id))).toContain(MARKER + '\none');
  });

  it('checks marker, preview, file identity and late invalidation before trash', async () => {
    const { store, vault, contents, files, trashFile } = fixture();
    const post = { id: '1795138832796_before', text: 'before' };
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

  it.each([['Hello', 'hello'], ['Straße', 'STRASSE'], ['ς', 'σ']])('uses a numbered suffix when %s and %s collide', async (original, conflicting) => {
    const { store, vault, files } = fixture();
    const first = draft(original);
    await store.publish(first);
    const second = draft(conflicting);
    const path = postPath(second.id);
    vault.create.mockRejectedValueOnce(Error('File already exists'));
    vault.adapter.exists.mockImplementation(async (candidate, sensitive) =>
      files.has(candidate) || (!sensitive && candidate === path));
    await store.publish(second);
    expect(postPath(second.id)).toBe(path.replace(/\.md$/, ' (2).md'));
    expect(store.list()).toEqual([first.id, second.id]);
    expect(await store.read(second.id)).toBe(conflicting);
  });

  it('keeps the attempted destination when a written file has not reached the vault index', async () => {
    const { store, vault, contents } = fixture();
    const post = draft('unindexed');
    const path = postPath(post.id);
    const error = Error('Interrupted after writing');
    vault.create.mockImplementationOnce(async (candidate, data) => {
      contents.set(candidate, data);
      throw error;
    });
    vault.adapter.exists.mockImplementation(async candidate => contents.has(candidate));

    await expect(store.publish(post)).rejects.toBe(error);
    expect(postPath(post.id)).toBe(path);
    expect([...contents.keys()]).toEqual([path]);
  });

  it('tries the pending numbered filename only once before choosing another suffix', async () => {
    const { store, vault } = fixture();
    const original = draft('collision');
    original.id += ' (2)';
    await store.publish(original);
    const pending = { ...original, id: (Number(original.id.slice(0, 13)) + 1) + original.id.slice(13) };
    const attempted = postPath(pending.id);
    vault.create.mockClear();

    await store.publish(pending);

    expect(vault.create.mock.calls.map(([path]) => path)).toEqual([attempted, attempted.replace('(2)', '(3)')]);
  });

  it('clears stale cached stamps outside Murmline and treats broken YAML frontmatter as non-post', async () => {
    const { store, contents } = fixture();
    const post = draft('moved');
    await store.publish(post);
    const file = store.file(post.id)!;
    const originalPath = file.path;

    // Move out of Murmline, rewrite frontmatter, then move back.
    file.path = 'Notes/moved.md';
    const newStamp = Number(post.id.slice(0, 13)) + 5000;
    contents.set(originalPath, `---\nmurmline-created: ${newStamp}\n---\n${MARKER}\nmoved`);
    expect(store.metadataChanged(file, newStamp)).toEqual([]);
    file.path = originalPath;
    expect(store.idAt(file)).toBe(newStamp + post.id.slice(13));

    // Malformed YAML frontmatter returns null rather than throwing a read error.
    contents.set(originalPath, `---\nmurmline-created: [broken\n---\n${MARKER}\nmoved`);
    expect(await store.readPost(newStamp + post.id.slice(13), true)).toBeNull();
  });
});
