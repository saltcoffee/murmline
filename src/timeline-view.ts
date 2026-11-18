import { ItemView, Menu, Notice, Scope, type WorkspaceLeaf } from 'obsidian';
import { DeleteModal } from './delete-modal';
import { errorDetail, Feed } from './feed';
import type { Language } from './i18n';
import { dayKey, draft, inspect, LIMIT, pathId, Post, postPath, ROOT } from './post';
import { PostStore } from './post-store';
import { TimelineList } from './timeline-list';

export const VIEW = 'murmline-timeline';
export class TimelineView extends ItemView {
  private readonly feed: Feed;
  private list!: TimelineList;
  private input!: HTMLTextAreaElement;
  private counter!: HTMLElement;
  private send!: HTMLButtonElement;
  private status!: HTMLElement;
  private feedback!: HTMLElement;
  private older!: HTMLButtonElement;
  private modal?: DeleteModal;
  private pending?: Post;
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

  constructor(leaf: WorkspaceLeaf, private store: PostStore, private lang: Language) {
    super(leaf);
    this.feed = new Feed(store);
    this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 'Enter', event => {
      if (event.target !== this.input || event.isComposing || this.composing || event.keyCode === 229) return;
      event.stopPropagation();
      void this.publish();
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
    const label = composer.createEl('label', { cls: 'murmline-field' });
    label.createSpan({ cls: 'murmline-sr-only', text: t.input });
    this.input = label.createEl('textarea', { attr: { placeholder: t.placeholder, rows: '3' } });
    const controls = composer.createDiv({ cls: 'murmline-controls' });
    this.counter = controls.createEl('span', { cls: 'murmline-count' });
    this.send = controls.createEl('button', { cls: 'mod-cta' });
    this.feedback = composer.createDiv({ attr: { role: 'status' }, cls: 'murmline-feedback' });
    this.input.oninput = () => {
      this.pending = undefined;
      this.feedback.empty();
      this.updateComposer();
    };
    this.registerDomEvent(this.input, 'compositionstart', () => { this.composing = true; });
    this.registerDomEvent(this.input, 'compositionend', () => { this.composing = false; this.updateComposer(); });
    this.send.onclick = () => void this.publish();
    this.updateComposer();
    this.list = new TimelineList(column.createDiv(), root, this.lang,
      (post, button) => this.menu(post, button), id => void this.run(async () => { await this.feed.reload(id); }));
    this.status = column.createDiv({ cls: 'murmline-status', attr: { role: 'status' } });
    this.older = column.createEl('button', { cls: 'murmline-older' });
    this.older.hidden = true;
    this.older.onclick = event => this.page(event.detail === 0);
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
    if (clock !== this.clock) { this.clock = clock; this.render(); }
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
    this.paging = true;
    this.pageError = '';
    this.render();
    void this.run(async () => {
      try {
        if (this.dirty.size) await this.flush();
        const first = !this.ready || this.feed.more ? await this.feed.page(() => this.live) : undefined;
        if (keyboard) this.pageFocus = first ?? [...this.feed.rows.keys()].sort()[0] ?? null;
        this.ready = true;
      } finally { this.paging = false; }
    });
  }

  private render() {
    this.list.render(this.feed.rows, this.clock);
    const { t } = this.lang;
    const loading = this.paging || !this.ready;
    const message = this.pageError || (loading ? t.loading : this.feed.rows.size ? '' : t.empty);
    if (this.status.textContent !== message) this.status.setText(message);
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

  private async publish() {
    const body = inspect(this.input.value);
    if (!body.valid || this.saving || this.composing) return;
    const post = this.pending ??= draft(body.text);
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
    this.input.value = '';
    this.updateComposer();
    this.change(postPath(post.id));
    this.focusComposer();
  }

  private menu(post: Post, button: HTMLButtonElement) {
    const menu = new Menu();
    menu.addItem(item => item.setTitle(this.lang.t.remove).setIcon('trash-2').onClick(() => {
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
    }));
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, button.ownerDocument);
  }

  override async onClose() {
    this.live = false;
    this.modal?.closeWithView();
    this.contentEl.empty();
  }
}
