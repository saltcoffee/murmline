import { App, TFile, TFolder } from 'obsidian';
import { inspect, isPostId, parseHeader, pathId, Post, postPath, ROOT, serialize } from './post';

export class PostError extends Error {
  constructor(readonly reason: 'invalid' | 'occupied', readonly path: string) {
    super(reason + ': ' + path);
  }
}

export type ReadPost = { text: string; quoteId?: string };

export class PostStore {
  constructor(readonly app: App) {}

  list(): string[] {
    const folder = this.app.vault.getAbstractFileByPath(ROOT);
    if (!folder) return [];
    if (!(folder instanceof TFolder)) throw new PostError('occupied', ROOT);
    const ids: string[] = [];
    for (const month of folder.children) {
      if (!(month instanceof TFolder) || !/^\d{4}-\d\d$/.test(month.name)) continue;
      for (const child of month.children) {
        const id = child instanceof TFile && pathId(child.path);
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  file(id: string) {
    const file = this.app.vault.getAbstractFileByPath(postPath(id));
    return file instanceof TFile ? file : null;
  }

  async readPost(id: string, fresh = false): Promise<ReadPost | null> {
    const file = this.file(id);
    if (!file) return null;
    const vault = this.app.vault;
    const raw = fresh ? await vault.read(file) : await vault.cachedRead(file);
    if (this.file(id) !== file) return null;
    const newline = raw.indexOf('\n');
    const header = (newline < 0 ? raw : raw.slice(0, newline)).replace(/\r$/, '');
    const parsed = parseHeader(header);
    if (!parsed) return null;
    if (parsed.version === 'invalid') throw new PostError('invalid', file.path);
    if (newline < 0) throw new PostError('invalid', file.path);
    if (parsed.version === 2 && parsed.quoteId === id) throw new PostError('invalid', file.path);
    const body = inspect(raw.slice(newline + 1));
    if (!body.valid) throw new PostError('invalid', file.path);
    return parsed.version === 2
      ? { text: body.text, quoteId: parsed.quoteId }
      : { text: body.text };
  }

  async read(id: string, fresh = false): Promise<string | null> {
    const post = await this.readPost(id, fresh);
    return post ? post.text : null;
  }

  private async ensureFolder(path: string) {
    const vault = this.app.vault;
    if (!vault.getAbstractFileByPath(path)) {
      try { await vault.createFolder(path); }
      catch (error) { if (!vault.getAbstractFileByPath(path)) throw error; }
    }
    if (!(vault.getAbstractFileByPath(path) instanceof TFolder)) throw new PostError('occupied', path);
  }

  async publish(post: Post) {
    const path = postPath(post.id);
    const body = inspect(post.text);
    if (!body.valid) throw new PostError('invalid', path);
    if (post.quoteId !== undefined && (!isPostId(post.quoteId) || post.quoteId === post.id))
      throw new PostError('invalid', path);
    const data = serialize(body.text, post.quoteId);
    await this.ensureFolder(ROOT);
    await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
    try { await this.app.vault.create(path, data); }
    catch (error) {
      const file = this.file(post.id);
      if (!file) throw error;
      if (await this.app.vault.read(file) !== data) throw new PostError('occupied', path);
    }
  }

  // The caller invalidates its preview synchronously on vault events and modal close.
  async remove(post: Post, target: TFile, current: () => boolean, beforeTrash: () => void) {
    const found = await this.readPost(post.id, true);
    if (!current()) return 'stale';
    if (found === null || this.file(post.id) !== target) return 'gone';
    if (found.text !== post.text || found.quoteId !== post.quoteId) return 'changed';
    beforeTrash();
    await this.app.fileManager.trashFile(target);
    return 'deleted';
  }
}
