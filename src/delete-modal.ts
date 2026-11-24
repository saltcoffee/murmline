import { Modal, Notice, type TFile } from 'obsidian';
import { errorDetail } from './feed';
import type { Language } from './i18n';
import { createdAt, dayLabel, localTime, Post, postPath } from './post';
import { PostError, PostStore } from './post-store';

export class DeleteModal extends Modal {
  private revision = 0;
  private openPreview = false;
  private committing = false;
  private deleted = false;
  private preview!: HTMLElement;
  private status!: HTMLElement;
  private cancel!: HTMLButtonElement;
  private confirm!: HTMLButtonElement;
  private retry!: HTMLButtonElement;

  constructor(private store: PostStore, private lang: Language, private post: Post,
    private target: TFile, private finished: (deleted: boolean) => void) {
    super(store.app);
  }

  override onOpen() {
    const { t } = this.lang;
    this.openPreview = true;
    this.titleEl.setText(t.confirm);
    const date = createdAt(this.post.id);
    this.contentEl.createEl('small', { text: dayLabel(date, new Date(), this.lang) + ' · ' + localTime(date) });
    this.preview = this.contentEl.createEl('p', { cls: 'murmline-preview', text: this.post.text });
    this.status = this.contentEl.createDiv({ attr: { role: 'status' } });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    this.cancel = buttons.createEl('button', { text: t.cancel });
    this.cancel.onclick = () => this.close();
    this.retry = buttons.createEl('button', { text: t.retry });
    this.retry.hidden = true;
    this.retry.onclick = () => void this.refresh();
    this.confirm = buttons.createEl('button', { text: t.remove, cls: 'mod-warning' });
    this.confirm.onclick = () => void this.submit();
    this.cancel.focus();
    void this.refresh();
  }

  changed(path: string, moved: boolean) {
    const original = postPath(this.post.id);
    if (!this.openPreview || this.committing || (original !== path && !original.startsWith(path + '/'))) return;
    if (moved) this.dismissGone();
    else void this.refresh(true);
  }

  private dismissGone() {
    new Notice(this.lang.t.gone);
    this.close();
  }

  private async refresh(changed = false) {
    const revision = ++this.revision;
    this.confirm.disabled = true;
    this.retry.hidden = true;
    try {
      const found = await this.store.readPost(this.post.id, true);
      if (revision !== this.revision) return;
      if (found === null || this.store.file(this.post.id) !== this.target) return this.dismissGone();
      if (changed || found.text !== this.post.text || found.quoteId !== this.post.quoteId) this.status.setText(this.lang.t.changed);
      else this.status.empty();
      this.post = { ...this.post, text: found.text, quoteId: found.quoteId };
      this.preview.setText(found.text);
      this.confirm.disabled = false;
      this.cancel.focus();
    } catch (error) {
      if (revision !== this.revision) return;
      if (error instanceof PostError) return this.dismissGone();
      this.status.setText(this.lang.t.readError);
      this.retry.hidden = false;
    }
  }

  private async submit() {
    if (this.confirm.disabled) return;
    const revision = this.revision;
    this.confirm.disabled = true;
    try {
      const result = await this.store.remove(this.post, this.target, () => revision === this.revision,
        () => {
          this.committing = true;
          this.cancel.disabled = true;
          this.status.setText(this.lang.t.deleting);
        });
      if (revision !== this.revision || result === 'stale') return;
      if (result === 'changed') return void this.refresh(true);
      if (result === 'gone') return this.dismissGone();
      this.deleted = true;
      this.committing = false;
      this.close();
    } catch (error) {
      if (revision !== this.revision) return;
      if (!this.committing && error instanceof PostError) return this.dismissGone();
      this.committing = false;
      this.cancel.disabled = false;
      this.status.setText([this.lang.t.deleteError, errorDetail(error, this.lang.t)].filter(Boolean).join(' '));
      this.confirm.disabled = false;
      this.cancel.focus();
    }
  }

  override close() {
    if (!this.committing) super.close();
  }

  closeWithView() {
    super.close();
  }

  override onClose() {
    ++this.revision;
    this.openPreview = false;
    this.contentEl.empty();
    if (!this.committing) this.finished(this.deleted);
  }
}
