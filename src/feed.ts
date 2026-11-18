import { pathId, postPath, ROOT } from './post';
import { PostError, type PostStore } from './post-store';

export type Row = { id: string; text: string } | { id: string; error: unknown };
const PAGE_SIZE = 50;

// Unread IDs can lie between displayed rows when a sync batch spans the
// current window. Keep them until a page consumes them, irrespective of age.
export class Feed {
  readonly rows = new Map<string, Row>();
  private candidates: Set<string> | null = null;
  private unread = new Set<string>();
  private oldestRead: string | null = null;
  get more() { return !this.candidates || this.unread.size > 0; }
  constructor(private store: Pick<PostStore, 'list' | 'read' | 'file'>) {}

  async reload(id: string) {
    try {
      const text = await this.store.read(id);
      if (text !== null) this.rows.set(id, { id, text });
      else this.rows.delete(id);
    } catch (error) {
      if (this.store.file(id)) this.rows.set(id, { id, error });
      else this.rows.delete(id);
    }
  }

  private async readPage(keys: Iterable<string>, active: () => boolean) {
    let valid = 0;
    let first: string | undefined;
    for (const id of [...keys].sort().reverse()) {
      if (!active()) break;
      await this.reload(id);
      this.unread.delete(id);
      if (this.oldestRead === null || id < this.oldestRead) this.oldestRead = id;
      const row = this.rows.get(id);
      if (row) first ??= id;
      if (row && 'text' in row && ++valid === PAGE_SIZE) break;
    }
    return first;
  }

  async page(active = () => true) {
    if (!this.candidates) {
      this.candidates = new Set(this.store.list());
      this.unread = new Set(this.candidates);
    }
    return this.readPage(this.unread, active);
  }

  async changed(paths: Set<string>, active = () => true) {
    if (!this.candidates) return;
    const wasAtEnd = !this.more;
    const folders = [...paths].filter(path => path === ROOT || /^Murmline\/\d{4}-\d\d$/.test(path));
    const affected = new Set<string>();
    const added = new Set<string>();
    if (folders.length) {
      const previous = this.candidates;
      this.candidates = new Set(this.store.list());
      for (const id of new Set([...previous, ...this.candidates])) {
        if (!previous.has(id)) added.add(id);
        if (!previous.has(id) || !this.candidates.has(id) || folders.some(f => postPath(id).startsWith(f + '/'))) affected.add(id);
      }
    }
    for (const path of paths) {
      const id = pathId(path);
      if (!id) continue;
      affected.add(id);
      if (this.store.file(id)) {
        if (!this.candidates.has(id)) added.add(id);
        this.candidates.add(id);
      } else this.candidates.delete(id);
    }
    const visibleAdditions: string[] = [];
    for (const id of affected) {
      if (!active()) return;
      if (!this.candidates.has(id)) {
        this.unread.delete(id);
        this.rows.delete(id);
      } else if (added.has(id)) {
        this.unread.add(id);
        if (wasAtEnd || (this.oldestRead !== null && id >= this.oldestRead)) visibleAdditions.push(id);
      } else if (!this.unread.has(id)) {
        await this.reload(id);
      }
    }
    if (!this.rows.size) {
      this.oldestRead = null;
      await this.readPage(this.unread, active);
    } else if (visibleAdditions.length) {
      await this.readPage(visibleAdditions, active);
    }
  }
}

export function errorDetail(error: unknown, labels: {invalid: string; occupied: string}) {
  return error instanceof PostError ? labels[error.reason] + ': ' + error.path : '';
}
