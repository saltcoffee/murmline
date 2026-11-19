import { ItemView, Menu, Notice, Scope, setIcon, type WorkspaceLeaf } from 'obsidian';
import { DeleteModal } from './delete-modal';
import { errorDetail, Feed, type SearchBegin } from './feed';
import type { Language } from './i18n';
import { createdAt, dayKey, dayLabel, draft, inspect, LIMIT, localTime, pathId, Post, postPath, ROOT } from './post';
import { PostError, PostStore } from './post-store';
import { TimelineList } from './timeline-list';

export const VIEW = 'murmline-timeline';

// Hidden <label> associations give screen readers a name without using
// aria-label, which Obsidian would render as a hover tooltip.
let labelSeq = 0;
const nextLabelId = (prefix: string) => 'murmline-' + prefix + '-' + (++labelSeq);

type Quoting = { id: string; text: string; missing?: boolean };

export class TimelineView extends ItemView {
  private readonly feed: Feed;
  private list!: TimelineList;
  private input!: HTMLTextAreaElement;
  private counter!: HTMLElement;
  private send!: HTMLButtonElement;
  private status!: HTMLElement;
  private feedback!: HTMLElement;
  private older!: HTMLButtonElement;
  private quoteBar!: HTMLElement;
  private quoteBarLabel!: HTMLElement;
  private quoteBarText!: HTMLElement;
  private quoteBarCancel!: HTMLButtonElement;
  private searchBar!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private searchClear!: HTMLButtonElement;
  private searchStatus!: HTMLElement;
  private modal?: DeleteModal;
  private pending?: Post;
  private quoting?: Quoting;
  private quoteRevision = 0;
  private dirty = new Set<string>();
  private queuedChanges = false;
  private serial = Promise.resolve();
  private live = false;
  private ready = false;
  private paging = false;
  private pageFocus?: string | null;
  private saving = false;
  private composing = false;
  private pageError = '';
  private clock = '';
  private searchTimer?: number;
  private searchLoading = false;

  constructor(leaf: WorkspaceLeaf, private store: PostStore, private lang: Language) {
    super(leaf);
    this.feed = new Feed(store);
    this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 'Enter', event => {
      if (event.target !== this.input || event.isComposing || this.composing) return;
      event.stopPropagation();
      void this.publish();
      return false;
    });
    this.scope.register(['Mod'], 'f', event => {
      if (!this.searchInput || this.searchBar.hidden) return;
      event.preventDefault();
      this.searchInput.focus();
      this.searchInput.select();
      return false;
    });
    this.scope.register([], 'Escape', event => {
      if (event.target !== this.searchInput || event.isComposing || this.composing) return;
      event.stopPropagation();
      if (this.searchInput.value) {
        this.searchInput.value = '';
        this.applySearch('');
      } else this.focusComposer();
      return false;
    });
  }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Murmline'; }
  override getIcon() { return 'feather'; }

  override async onOpen() {
    this.live = true;
    const { t } = this.lang;
    const root = this.contentEl;
    root.empty();
    root.addClass('murmline-view');
    const column = root.createDiv({ cls: 'murmline-column' });
    const composer = column.createDiv({ cls: 'murmline-composer' });

    this.quoteBar = composer.createDiv({ cls: 'murmline-quote-bar' });
    this.quoteBar.hidden = true;
    this.quoteBarLabel = this.quoteBar.createDiv({ cls: 'murmline-quote-bar-label' });
    this.quoteBarText = this.quoteBar.createDiv({ cls: 'murmline-quote-bar-text' });
    this.quoteBarCancel = this.quoteBar.createEl('button', {
      cls: 'clickable-icon murmline-quote-cancel', attr: { 'aria-label': t.cancelQuote, type: 'button' },
    });
    setIcon(this.quoteBarCancel, 'x');
    this.quoteBarCancel.onclick = () => this.cancelQuote();

    const inputId = nextLabelId('input');
    composer.createEl('label', { cls: 'murmline-sr-only', text: t.input, attr: { for: inputId } });
    this.input = composer.createEl('textarea', {
      attr: { id: inputId, placeholder: t.placeholder, rows: '3' },
    });
    const controls = composer.createDiv({ cls: 'murmline-controls' });
    this.counter = controls.createSpan({ cls: 'murmline-count' });
    this.send = controls.createEl('button', { cls: 'mod-cta' });
    this.feedback = composer.createDiv({ attr: { role: 'status' }, cls: 'murmline-feedback' });
    this.input.oninput = () => {
      this.pending = undefined;
      this.feedback.empty();
      this.updateComposer();
    };
    this.registerDomEvent(column, 'compositionstart', () => { this.composing = true; });
    this.registerDomEvent(column, 'compositionend', () => { this.composing = false; this.updateComposer(); });
    this.send.onclick = () => void this.publish();
    this.updateComposer();

    this.searchBar = column.createDiv({ cls: 'murmline-search' });
    this.searchBar.hidden = true;
    const searchId = nextLabelId('search');
    this.searchBar.createEl('label', { cls: 'murmline-sr-only', text: t.searchPlaceholder, attr: { for: searchId } });
    this.searchInput = this.searchBar.createEl('input', {
      cls: 'murmline-search-input',
      attr: { id: searchId, role: 'searchbox', inputmode: 'search', placeholder: t.searchPlaceholder },
    });
    this.searchClear = this.searchBar.createEl('button', {
      cls: 'clickable-icon murmline-search-clear', attr: { 'aria-label': t.clearSearch, type: 'button' },
    });
    setIcon(this.searchClear, 'x');
    this.searchClear.hidden = true;
    this.searchClear.onclick = () => {
      this.searchInput.value = '';
      this.updateSearchClear();
      this.searchInput.focus();
      this.applySearch('');
    };
    this.searchInput.oninput = () => { this.updateSearchClear(); this.scheduleSearch(false); };
    this.searchStatus = column.createDiv({ cls: 'murmline-search-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.searchStatus.hidden = true;

    this.list = new TimelineList(column.createDiv(), root, this.lang, {
      menu: (post, button) => this.menu(post, button),
      retry: id => void this.run(async () => { await this.feed.reload(id); }),
      quote: id => this.revealQuote(id),
      retryQuote: id => void this.run(async () => { await this.feed.retryQuote(id); }),
      tag: tag => this.toggleTag(tag),
    });
    this.status = column.createDiv({ cls: 'murmline-status', attr: { role: 'status' } });
    this.older = column.createEl('button', { cls: 'murmline-older' });
    this.older.hidden = true;
    this.older.onclick = event => this.olderAction(event.detail === 0);
    const win = root.ownerDocument.defaultView!;
    this.registerDomEvent(win, 'focus', () => this.checkClock());
    this.registerDomEvent(root.ownerDocument, 'visibilitychange', () => this.checkClock());
    this.registerInterval(win.setInterval(() => this.checkClock(), 30_000));
    this.checkClock();
    this.app.workspace.onLayoutReady(() => {
      if (!this.live) return;
      const vault = this.app.vault;
      this.registerEvent(vault.on('create', file => this.change(file.path)));
      this.registerEvent(vault.on('modify', file => this.change(file.path)));
      this.registerEvent(vault.on('delete', file => this.change(file.path, true)));
      this.registerEvent(vault.on('rename', (file, oldPath) => {
        this.change(oldPath, true);
        this.change(file.path);
      }));
      this.page();
    });
  }

  private checkClock() {
    if (!this.live || this.contentEl.ownerDocument.hidden) return;
    const clock = Intl.DateTimeFormat().resolvedOptions().timeZone + '/' + dayKey(new Date());
    if (clock !== this.clock) {
      this.clock = clock;
      if (this.quoting) this.updateQuoteBar();
      this.render();
    }
  }

  private run(task: () => Promise<void>) {
    this.serial = this.serial.then(async () => {
      if (!this.live) return;
      try { await task(); }
      catch (error) { this.pageError = [this.lang.t.loadError, errorDetail(error, this.lang.t)].filter(Boolean).join(' '); }
      if (this.live) this.render();
    });
    return this.serial;
  }

  private change(path: string, moved = false) {
    if (!this.live || !(path === ROOT || /^Murmline\/\d{4}-\d\d$/.test(path) || pathId(path))) return;
    this.dirty.add(path);
    if (!this.queuedChanges) {
      this.queuedChanges = true;
      void this.run(async () => {
        this.queuedChanges = false;
        await this.flush();
      });
    }
    this.quoteChanged(path, moved);
    this.modal?.changed(path, moved);
  }

  private async flush() {
    const paths = this.dirty;
    this.dirty = new Set();
    try { await this.feed.changed(paths, () => this.live); }
    catch (error) { for (const path of paths) this.dirty.add(path); throw error; }
  }

  private page(keyboard = false) {
    if (this.paging) return;
    const token = this.feed.session;
    this.paging = true;
    this.pageError = '';
    this.render();
    void this.run(async () => {
      try {
        if (this.dirty.size) await this.flush();
        const first = !this.ready || this.feed.more ? await this.feed.page(() => this.live, token) : undefined;
        if (token !== this.feed.session) return;
        if (keyboard) this.pageFocus = first ?? [...this.feed.rows.keys()].sort()[0] ?? null;
        this.ready = true;
      } finally { this.paging = false; }
    });
  }

  private olderAction(keyboard: boolean) {
    if (this.pageError && this.searchInput.value.trim()) { this.applySearch(this.searchInput.value); return; }
    this.page(keyboard);
  }

  private render() {
    this.list.render(this.feed.rows, this.clock);
    const { t } = this.lang;
    const searching = this.feed.searching;
    const loading = this.paging || !this.ready || this.searchLoading;
    let message = '';
    if (this.pageError) message = this.pageError;
    else if (!searching) {
      if (loading) message = t.loading;
      else if (!this.feed.rows.size) message = t.empty;
    }
    if (this.status.textContent !== message) this.status.setText(message);
    this.renderSearch(searching, loading);
    if (!this.paging) {
      const hide = !this.pageError && (!this.ready || !this.feed.more);
      if (this.pageFocus !== undefined && this.contentEl.ownerDocument.activeElement === this.older) {
        if (this.pageFocus) this.list.focus(this.pageFocus, false);
        else this.focusComposer();
      }
      this.pageFocus = undefined;
      this.older.hidden = hide;
    }
    this.older.setAttribute('aria-disabled', String(this.paging));
    this.older.setText(this.paging ? t.loading : this.pageError ? t.retry : t.earlier);
  }

  private renderSearch(searching: boolean, loading: boolean) {
    const { t } = this.lang;
    const hasContent = this.feed.rows.size > 0 || (this.ready && this.feed.more);
    this.searchBar.hidden = !searching && !hasContent;
    let status = '';
    if (searching) {
      if (loading) status = t.searching;
      else if (!this.feed.rows.size) status = t.noResults;
    }
    const errors = this.feed.searchErrorCount;
    if (searching && errors) status = [status, t.searchPartial(errors)].filter(Boolean).join(' ');
    if (this.searchStatus.textContent !== status) this.searchStatus.setText(status);
    this.searchStatus.hidden = !searching && !status;
    this.updateSearchClear();
  }

  private updateSearchClear() {
    this.searchClear.hidden = this.searchInput.value.length === 0;
  }

  private scheduleSearch(immediate: boolean) {
    const win = this.contentEl.ownerDocument.defaultView!;
    if (this.searchTimer !== undefined) { win.clearTimeout(this.searchTimer); this.searchTimer = undefined; }
    const value = this.searchInput.value;
    this.searchTimer = win.setTimeout(() => {
      this.searchTimer = undefined;
      this.applySearch(value);
    }, immediate ? 0 : 180);
  }

  private applySearch(value: string) {
    this.pageError = '';
    // An immediate apply (Esc, clear, tag click) must cancel any pending debounce,
    // otherwise the old keyword re-applies after the box was cleared.
    if (this.searchTimer !== undefined) {
      this.contentEl.ownerDocument.defaultView?.clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    let result: SearchBegin;
    try { result = this.feed.begin(value); }
    catch (error) {
      this.searchLoading = false;
      this.pageError = [this.lang.t.loadError, errorDetail(error, this.lang.t)].filter(Boolean).join(' ');
      this.render();
      return;
    }
    const token = result.token;
    this.searchLoading = result.searching;
    this.render();
    if (!result.searching) return;
    // Capture the session token so a stale queued run cannot load a later page
    // or fall back to the plain timeline, and cannot clear a newer load state.
    void this.run(async () => {
      try { await this.feed.page(() => this.live, token); }
      finally { if (this.feed.session === token) this.searchLoading = false; }
    });
  }

  private toggleTag(value: string) {
    const next = this.searchInput.value.trim() === value ? '' : value;
    this.searchInput.value = next;
    this.updateSearchClear();
    this.searchInput.focus();
    this.applySearch(next);
  }

  focusComposer() {
    this.contentEl.scrollTop = 0;
    this.input.focus({ preventScroll: true });
  }

  private updateComposer() {
    const { t } = this.lang;
    const { count, valid } = inspect(this.input.value);
    const over = count > LIMIT;
    this.counter.setText(over ? t.over(count - LIMIT) : count + ' / ' + LIMIT);
    this.counter.toggleClass('is-over', over);
    this.counter.setAttribute('aria-live', over ? 'polite' : 'off');
    this.input.setAttribute('aria-invalid', String(over));
    this.input.readOnly = this.saving;
    this.send.disabled = this.saving || !valid;
    this.send.setText(this.saving ? t.posting : t.post);
  }

  private startQuote(post: Post) {
    this.quoting = { id: post.id, text: post.text };
    this.pending = undefined;
    this.updateQuoteBar();
    this.focusComposer();
  }

  private cancelQuote() {
    this.quoting = undefined;
    this.pending = undefined;
    this.updateQuoteBar();
    this.input.focus();
  }

  private quoteLabel(id: string) {
    const date = createdAt(id);
    return dayLabel(date, new Date(), this.lang, 'compact') + ' ' + localTime(date);
  }

  private updateQuoteBar() {
    const { t } = this.lang;
    const quoting = this.quoting;
    if (!quoting) { this.quoteBar.hidden = true; return; }
    this.quoteBar.hidden = false;
    if (quoting.missing) {
      this.quoteBarLabel.setText(t.quoteDeleted);
      this.quoteBarText.setText('');
      this.quoteBarText.hidden = true;
    } else {
      this.quoteBarLabel.setText(t.quoteOf(this.quoteLabel(quoting.id)));
      this.quoteBarText.setText(quoting.text);
      this.quoteBarText.hidden = false;
    }
  }

  private quoteChanged(path: string, moved: boolean) {
    const quoting = this.quoting;
    if (!quoting) return;
    const qpath = postPath(quoting.id);
    if (path !== qpath && !qpath.startsWith(path + '/')) return;
    // Keep watching a missing target so moving it back restores the preview.
    const revision = ++this.quoteRevision;
    if (moved || !this.store.file(quoting.id)) {
      if (!quoting.missing) { quoting.missing = true; this.updateQuoteBar(); }
    } else void this.refreshQuoting(quoting, revision);
  }

  private async refreshQuoting(quoting: Quoting, revision: number) {
    let post;
    try { post = await this.store.readPost(quoting.id, true); }
    catch (error) {
      if (!(error instanceof PostError && error.reason === 'invalid')) return;
    }
    if (!this.live || this.quoting !== quoting || this.quoteRevision !== revision) return;
    quoting.missing = !post;
    if (post) quoting.text = post.text;
    this.updateQuoteBar();
  }

  private async publish() {
    const body = inspect(this.input.value);
    if (!body.valid || this.saving || this.composing) return;
    const post = this.pending ??= draft(body.text, this.quoting?.id);
    this.saving = true;
    this.feedback.empty();
    this.updateComposer();
    try {
      await this.store.publish(post);
    } catch (error) {
      if (this.live) this.feedback.setText([this.lang.t.saveError, errorDetail(error, this.lang.t)].filter(Boolean).join(' '));
      return;
    } finally {
      this.saving = false;
      if (this.live) this.updateComposer();
    }
    if (!this.live) return;
    this.pending = undefined;
    this.quoting = undefined;
    this.input.value = '';
    this.updateQuoteBar();
    this.updateComposer();
    this.change(postPath(post.id));
    this.focusComposer();
  }

  private revealQuote(id: string) {
    if (this.list.reveal(id)) return;
    const file = this.store.file(id);
    if (file) void this.openFile(file);
    else new Notice(this.lang.t.gone);
  }

  private async openFile(file: import('obsidian').TFile) {
    try { await this.app.workspace.getLeaf('tab').openFile(file); }
    catch { new Notice(this.lang.t.gone); }
  }

  private stamp(id: string) {
    const date = createdAt(id);
    const pad = (n: number) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + localTime(date);
  }

  private async copyText(post: Post) {
    const { t } = this.lang;
    try { await navigator.clipboard.writeText(post.text); new Notice(t.copiedText); }
    catch { new Notice(t.copyError); }
  }

  private async copyLink(post: Post) {
    const { t } = this.lang;
    const file = this.store.file(post.id);
    if (!file) { new Notice(t.gone); return; }
    const alias = this.stamp(post.id);
    try {
      const link = this.app.fileManager.generateMarkdownLink(file, '', undefined, alias);
      await navigator.clipboard.writeText(link);
      new Notice(t.copiedLink);
    } catch { new Notice(t.copyError); }
  }

  private async openSource(post: Post) {
    const { t } = this.lang;
    const file = this.store.file(post.id);
    if (!file) { new Notice(t.gone); return; }
    try { await this.app.workspace.getLeaf('tab').openFile(file); }
    catch { new Notice(t.gone); }
  }

  private menu(post: Post, button: HTMLButtonElement) {
    const { t } = this.lang;
    const menu = new Menu();
    menu.addItem(item => item.setTitle(t.quote).setIcon('quote').onClick(() => this.startQuote(post)));
    menu.addItem(item => item.setTitle(t.copyText).setIcon('copy').onClick(() => void this.copyText(post)));
    menu.addItem(item => item.setTitle(t.copyLink).setIcon('link').onClick(() => void this.copyLink(post)));
    menu.addItem(item => item.setTitle(t.openSource).setIcon('file-text').onClick(() => void this.openSource(post)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle(t.remove).setIcon('trash-2').onClick(() => this.confirmDelete(post)));
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, button.ownerDocument);
  }

  private confirmDelete(post: Post) {
    const target = this.store.file(post.id);
    if (!target) { new Notice(this.lang.t.gone); return; }
    const ids = [...this.feed.rows.keys()].sort().reverse();
    const index = ids.indexOf(post.id);
    const neighbors = [ids[index + 1], ids[index - 1]];
    this.modal = new DeleteModal(this.store, this.lang, post, target, deleted => {
      this.modal = undefined;
      if (!this.live) return;
      if (deleted) this.change(postPath(post.id), true);
      void this.serial.then(() => {
        if (!this.live) return;
        const candidates = deleted ? neighbors : [post.id, ...neighbors];
        if (!candidates.some(id => id && this.list.focus(id))) this.focusComposer();
      });
    });
    this.modal.open();
  }

  override async onClose() {
    this.live = false;
    if (this.searchTimer !== undefined) {
      this.contentEl.ownerDocument.defaultView?.clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    this.modal?.closeWithView();
    this.contentEl.empty();
  }
}
