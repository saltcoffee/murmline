import type { TFile } from 'obsidian';
import { isPostId, matchesQuery, parseQuery, postPath, ROOT, type ParsedQuery } from './post';
import { PostError, type PostStore } from './post-store';

export type QuoteSnapshot =
  | { id: string; status: 'ok'; text: string }
  | { id: string; status: 'missing' }
  | { id: string; status: 'error'; error: unknown };

export type Row =
  | { id: string; text: string; quote?: QuoteSnapshot }
  | { id: string; error: unknown };

const PAGE_SIZE = 50;
const SEARCH_BATCH = 40;
type Store = Pick<PostStore, 'list' | 'readPost' | 'file'>;

type FileRevision = { file: TFile; ctime: number; mtime: number; size: number };

function revision(file: TFile): FileRevision {
  const { ctime, mtime, size } = file.stat;
  return { file, ctime, mtime, size };
}

function revisionChanged(previous: FileRevision, file: TFile | null) {
  return previous.file !== file || file.stat.ctime !== previous.ctime ||
    file.stat.mtime !== previous.mtime || file.stat.size !== previous.size;
}

function inFolders(id: string, folders: Set<string>) {
  if (folders.has(ROOT)) return true;
  const path = postPath(id);
  return folders.has(path.slice(0, path.lastIndexOf('/')));
}

function setSortedId(ids: string[], id: string, present: boolean) {
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ids[mid]! < id) lo = mid + 1;
    else hi = mid;
  }
  if (ids[lo] === id) {
    if (!present) ids.splice(lo, 1);
  } else if (present) ids.splice(lo, 0, id);
}

export type SearchBegin = { token: number; searching: boolean };

// Unread IDs can lie between displayed rows when a sync batch spans the
// current window. Keep them until a page consumes them, irrespective of age.
export class Feed {
  private timeline = new Map<string, Row>();
  private timelineRevisions = new Map<string, FileRevision>();
  private candidates: Set<string> | null = null;
  private unread = new Set<string>();
  private oldestRead: string | null = null;

  private hits?: Map<string, Row>;
  private query?: ParsedQuery;
  private queue: string[] = [];
  private visibleIds: string[] = [];
  // Unread candidates need no stat lookup until their body or quote is read.
  private revisions = new Map<string, FileRevision | undefined>();
  private failed = new Set<string>();
  private searchLimit = 0;
  private token = 0;
  private searchMode = false;

  constructor(private store: Store) {}

  get rows(): Map<string, Row> { return this.searchMode ? this.hits! : this.timeline; }
  get searching() { return this.searchMode; }
  get searchErrorCount() { return this.searchMode ? this.failed.size : 0; }
  get session() { return this.token; }
  get more() {
    return this.searchMode ? this.queue.length > 0 : !this.candidates || this.unread.size > 0;
  }

  private async readRow(id: string): Promise<Row | null> {
    try {
      this.rememberTimelineFile(id);
      const post = await this.store.readPost(id);
      if (!post) return null;
      const row: Row = { id, text: post.text };
      if (post.quoteId) {
        if (!this.timelineRevisions.has(post.quoteId)) this.rememberTimelineFile(post.quoteId);
        row.quote = await this.readQuote(post.quoteId);
      }
      return row;
    } catch (error) {
      return this.store.file(id) ? { id, error } : null;
    }
  }

  // Only the direct target is read here: a record that itself quotes something
  // else is shown as plain text, so cards never nest or recurse. A record that
  // lost its valid marker is unavailable, not a retryable read failure.
  private async readQuote(id: string): Promise<QuoteSnapshot> {
    try {
      const post = await this.store.readPost(id);
      return post ? { id, status: 'ok', text: post.text } : { id, status: 'missing' };
    } catch (error) {
      if (error instanceof PostError && error.reason === 'invalid') return { id, status: 'missing' };
      return this.store.file(id) ? { id, status: 'error', error } : { id, status: 'missing' };
    }
  }

  private rememberTimelineFile(id: string) {
    const file = this.store.file(id);
    if (file) this.timelineRevisions.set(id, revision(file));
  }

  private async reloadTimeline(id: string) {
    const row = await this.readRow(id);
    if (row) this.timeline.set(id, row);
    else this.timeline.delete(id);
  }

  async reload(id: string) {
    if (this.searchMode) { await this.updateSearch(new Set([id]), () => true); return; }
    await this.reloadTimeline(id);
  }

  async retryQuote(id: string) {
    const map = this.rows;
    const row = map.get(id);
    if (!row || !('text' in row) || !row.quote) return;
    const quote = await this.readQuote(row.quote.id);
    // The surrounding search may have been replaced or cleared while reading.
    if (this.rows !== map || map.get(id) !== row) return;
    map.set(id, { ...row, quote });
  }

  private async readPage(keys: Iterable<string>, active: () => boolean) {
    let valid = 0;
    let first: string | undefined;
    for (const id of [...keys].sort().reverse()) {
      if (!active()) break;
      await this.reloadTimeline(id);
      this.unread.delete(id);
      if (this.oldestRead === null || id < this.oldestRead) this.oldestRead = id;
      const row = this.timeline.get(id);
      if (row) first ??= id;
      if (row && 'text' in row && ++valid === PAGE_SIZE) break;
    }
    return first;
  }

  async page(active = () => true, token?: number): Promise<string | undefined> {
    if (token !== undefined && token !== this.token) return;
    if (this.searchMode) {
      this.searchLimit += PAGE_SIZE;
      return this.fill(active);
    }
    if (!this.candidates) {
      this.candidates = new Set(this.store.list());
      this.unread = new Set(this.candidates);
    }
    return this.readPage(this.unread, active);
  }

  async changed(paths: Set<string>, active = () => true) {
    await this.updateTimeline(paths, active);
    if (this.searchMode) await this.updateSearch(paths, active);
  }

  private async updateTimeline(paths: Set<string>, active: () => boolean) {
    if (!this.candidates) return;
    const wasAtEnd = this.unread.size === 0;
    const folders = new Set([...paths].filter(path => path === ROOT || /^Murmline\/\d{4}-\d\d$/.test(path)));
    const affected = new Set<string>();
    const added = new Set<string>();
    if (folders.size) {
      const previous = this.candidates;
      this.candidates = new Set(this.store.list());
      for (const id of new Set([...previous, ...this.candidates])) {
        if (!previous.has(id)) added.add(id);
        const stamp = this.timelineRevisions.get(id);
        if (!previous.has(id) || !this.candidates.has(id) ||
          (stamp && inFolders(id, folders) && revisionChanged(stamp, this.store.file(id)))) affected.add(id);
      }
    }
    for (const id of paths) {
      if (!isPostId(id)) continue;
      affected.add(id);
      if (this.store.file(id)) {
        if (!this.candidates.has(id)) added.add(id);
        this.candidates.add(id);
      } else this.candidates.delete(id);
    }
    const visibleAdditions: string[] = [];
    for (const id of affected) {
      if (!active()) return;
      this.timelineRevisions.delete(id);
      if (!this.candidates.has(id)) {
        this.unread.delete(id);
        this.timeline.delete(id);
      } else if (added.has(id)) {
        this.unread.add(id);
        if (wasAtEnd || (this.oldestRead !== null && id >= this.oldestRead)) visibleAdditions.push(id);
      } else if (!this.unread.has(id)) {
        await this.reloadTimeline(id);
      }
    }
    // A change to a quoted record must also refresh the cards that point at it.
    const touched = new Set<string>(affected);
    for (const id of [...this.timeline.keys()]) {
      if (touched.has(id)) continue;
      const row = this.timeline.get(id);
      if (row && 'text' in row && row.quote && touched.has(row.quote.id)) {
        if (!active()) return;
        await this.reloadTimeline(id);
      }
    }
    if (!this.timeline.size) {
      this.oldestRead = null;
      await this.readPage(this.unread, active);
    } else if (visibleAdditions.length) {
      await this.readPage(visibleAdditions, active);
    }
  }

  // Entering, replacing or leaving search invalidates the previous scan token
  // synchronously so an in-flight batch can abort before it touches new
  // results. Candidates are listed before any state changes, so a failed
  // listing leaves the previous view intact and can be retried.
  begin(raw: string): SearchBegin {
    const query = parseQuery(raw);
    if (!query) {
      this.token++;
      this.resetSearch();
      return { token: this.token, searching: false };
    }
    const ids = this.store.list().sort();
    this.token++;
    this.searchMode = true;
    this.query = query;
    this.hits = new Map();
    this.queue = ids;
    this.visibleIds = [];
    this.revisions = new Map(ids.map(id => [id, undefined]));
    this.failed.clear();
    this.searchLimit = 0;
    return { token: this.token, searching: true };
  }

  private resetSearch() {
    this.searchMode = false;
    this.query = undefined;
    this.hits = undefined;
    this.queue = [];
    this.visibleIds = [];
    this.revisions.clear();
    this.failed.clear();
    this.searchLimit = 0;
  }

  async search(raw: string, active = () => true) {
    const result = this.begin(raw);
    if (result.searching) await this.page(active, result.token);
  }

  private rememberFile(id: string) {
    if (this.revisions.get(id)) return;
    const file = this.store.file(id);
    if (file) this.revisions.set(id, revision(file));
  }

  private async fill(active: () => boolean): Promise<string | undefined> {
    const token = this.token;
    const hits = this.hits!;
    const query = this.query!;
    let first: string | undefined;
    let scanned = 0;
    while (this.queue.length && this.searchLimit > 0) {
      if (scanned && scanned % SEARCH_BATCH === 0) await new Promise(resolve => setTimeout(resolve, 0));
      if (token !== this.token || !active()) break;
      const id = this.queue[this.queue.length - 1]!;
      const oldest = this.visibleIds[0];
      if (hits.size >= this.searchLimit && oldest && id < oldest) break;
      this.queue.pop();
      scanned++;
      try {
        this.rememberFile(id);
        const post = await this.store.readPost(id);
        if (token !== this.token || !active()) break;
        this.failed.delete(id);
        if (!post || !matchesQuery(post.text, query)) continue;
        const row: Row = { id, text: post.text };
        if (post.quoteId) {
          this.rememberFile(post.quoteId);
          row.quote = await this.readQuote(post.quoteId);
          if (token !== this.token || !active()) break;
        }
        if (oldest && hits.size >= this.searchLimit) {
          hits.delete(oldest);
          this.visibleIds.shift();
          setSortedId(this.queue, oldest, true);
        }
        first ??= id;
        hits.set(id, row);
        setSortedId(this.visibleIds, id, true);
      } catch {
        if (token !== this.token || !active()) break;
        if (this.store.file(id)) this.failed.add(id);
      }
    }
    return first;
  }

  private async updateSearch(paths: Set<string>, active: () => boolean) {
    const token = this.token;
    const folders = new Set([...paths].filter(path => path === ROOT || /^Murmline\/\d{4}-\d\d$/.test(path)));
    const changed = new Set<string>();
    if (folders.size) {
      const listed = new Set(this.store.list());
      for (const id of this.revisions.keys()) if (!listed.has(id)) changed.add(id);
      for (const id of listed) {
        if (!this.revisions.has(id)) { changed.add(id); continue; }
        const previous = this.revisions.get(id);
        if (previous && inFolders(id, folders) && revisionChanged(previous, this.store.file(id))) changed.add(id);
      }
    }
    for (const id of paths) if (isPostId(id)) changed.add(id);
    if (!changed.size) return;

    const hits = this.hits!;
    for (const id of changed) {
      const file = this.store.file(id);
      if (file) this.revisions.set(id, undefined);
      else { this.revisions.delete(id); this.failed.delete(id); }
      if (hits.delete(id)) setSortedId(this.visibleIds, id, false);
      setSortedId(this.queue, id, !!file);
    }

    // Only direct dependants need new quote snapshots. Their own bodies still match.
    for (const [id, row] of hits) {
      if ('text' in row && row.quote && changed.has(row.quote.id)) {
        this.rememberFile(row.quote.id);
        const quote = await this.readQuote(row.quote.id);
        if (token !== this.token || !active()) return;
        hits.set(id, { ...row, quote });
      }
    }
    await this.fill(active);
  }
}

export function errorDetail(error: unknown, labels: {invalid: string; occupied: string}) {
  return error instanceof PostError ? labels[error.reason] + ': ' + error.path : '';
}
