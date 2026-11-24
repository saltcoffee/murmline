import { App, getFrontMatterInfo, parseYaml, TFile, TFolder } from 'obsidian';
import { inspect, isPostId, parseHeader, pathId, Post, postPath, ROOT, serialize, slugify } from './post';

export class PostError extends Error {
  constructor(readonly reason: 'invalid' | 'occupied', readonly path: string) {
    super(reason + ': ' + path);
  }
}

export type ReadPost = { text: string; quoteId?: string };

export const CREATED = 'murmline-created';

export class PostStore {
  private readonly stamps = new WeakMap<TFile, number>();

  // The vault emits create before its metadata index is ready. Remember local
  // writes immediately, and keep the last known stamp for delete/rename events.
  idAt(file: TFile, path = file.path) {
    if (!/^Murmline\/\d{4}-\d{2}\/\d{4}\./.test(path)) return pathId(path);
    const stamp = this.stamps.get(file) ?? this.app.metadataCache.getFileCache(file)?.frontmatter?.[CREATED];
    const id = pathId(path, stamp);
    if (id) this.stamps.set(file, Number(id.slice(0, 13)));
    return id;
  }

  metadataChanged(file: TFile, stamp: unknown) {
    const previous = pathId(file.path, this.stamps.get(file));
    const current = pathId(file.path, stamp);
    if (current && current[13] === '@') this.stamps.set(file, Number(current.slice(0, 13)));
    else this.stamps.delete(file);
    if (previous === current) return [];
    return [previous, current].filter((id): id is string => !!id);
  }

  constructor(readonly app: App) {}

  list(): string[] {
    const folder = this.app.vault.getAbstractFileByPath(ROOT);
    if (!folder) return [];
    if (!(folder instanceof TFolder)) throw new PostError('occupied', ROOT);
    const ids: string[] = [];
    for (const month of folder.children) {
      if (!(month instanceof TFolder) || !/^\d{4}-\d\d$/.test(month.name)) continue;
      for (const child of month.children) {
        const id = child instanceof TFile && this.idAt(child);
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  file(id: string) {
    const file = this.app.vault.getAbstractFileByPath(postPath(id));
    return file instanceof TFile && this.idAt(file) === id ? file : null;
  }

  async readPost(id: string, fresh = false): Promise<ReadPost | null> {
    const file = this.file(id);
    if (!file) return null;
    const vault = this.app.vault;
    let raw = fresh ? await vault.read(file) : await vault.cachedRead(file);
    if (this.file(id) !== file) return null;
    if (id[13] === '@') {
      const info = getFrontMatterInfo(raw);
      if (!info.exists) return null;
      let frontmatter: Record<string, unknown> | null;
      try { frontmatter = parseYaml(info.frontmatter) as Record<string, unknown> | null; }
      catch { return null; }
      if (frontmatter?.[CREATED] !== Number(id.slice(0, 13))) return null;
      raw = raw.slice(info.contentStart);
    }
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
    const vault = this.app.vault;
    const path = postPath(post.id);
    const body = inspect(post.text);
    if (!body.valid) throw new PostError('invalid', path);
    if (post.quoteId !== undefined && (!isPostId(post.quoteId) || post.quoteId === post.id))
      throw new PostError('invalid', path);
    const dated = post.id[13] === '@';
    const stamp = Number(post.id.slice(0, 13));
    const prefix = dated ? '---\n' + CREATED + ': ' + stamp + '\n---\n' : '';
    const data = prefix + serialize(body.text, post.quoteId);
    await this.ensureFolder(ROOT);
    await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
    const baseId = dated ? post.id.slice(0, post.id.indexOf('_') + 1) + slugify(body.text) : post.id;
    const attemptedId = post.id;
    for (let n = 1; ; n++) {
      const id = n === 1 ? attemptedId : baseId + ' (' + n + ')';
      if (n > 1 && id === attemptedId) continue;
      // Keep the attempted destination if a write succeeds but its acknowledgement fails.
      post.id = id;
      const candidate = postPath(id);
      let file;
      try { file = await vault.create(candidate, data); }
      catch (error) {
        const existing = vault.getAbstractFileByPath(candidate);
        if (!existing) {
          // A file written at the exact path may still be waiting for the vault index.
          const occupied = await vault.adapter.exists(candidate, false);
          if (!occupied || await vault.adapter.exists(candidate, true)) throw error;
        }
        if (!(existing instanceof TFile) || existing.path !== candidate) {
          if (dated) continue;
          throw new PostError('occupied', candidate);
        }
        const raw = await vault.read(existing);
        if (raw !== data) {
          if (!dated || this.idAt(existing) === id || raw.startsWith(prefix))
            throw new PostError('occupied', candidate);
          continue;
        }
        file = existing;
      }
      if (dated) this.stamps.set(file, stamp);
      return;
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
