import { setIcon } from 'obsidian';
import { errorDetail, type QuoteSnapshot, type Row } from './feed';
import type { Language } from './i18n';
import { createdAt, dayKey, dayLabel, localTime, tokenizeBody, type Post } from './post';

type Handlers = {
  menu: (post: Post, button: HTMLButtonElement) => void;
  retry: (id: string) => void;
  quote: (id: string) => void;
  retryQuote: (id: string) => void;
  tag: (tag: string) => void;
};

type Item = {
  el: HTMLElement; divider: HTMLElement; time: HTMLElement; body: HTMLElement;
  action: HTMLButtonElement; quote?: HTMLElement; quoteMeta?: HTMLElement;
  highlightTimer?: number; row?: Row; dateKey?: string; clock?: string;
};

export class TimelineList {
  private items = new Map<string, Item>();
  constructor(private container: HTMLElement, private scroll: HTMLElement, private lang: Language,
    private handlers: Handlers) {}

  private create(): Item {
    const el = this.container.createEl('article', { cls: 'murmline-entry' });
    const divider = el.createEl('h3', { cls: 'murmline-divider' });
    const header = el.createDiv({ cls: 'murmline-meta' });
    const time = header.createEl('time');
    const action = header.createEl('button', { cls: 'clickable-icon murmline-action' });
    const body = el.createDiv({ cls: 'murmline-body' });
    return { el, divider, time, body, action };
  }

  render(rows: Map<string, Row>, clock: string) {
    const ids = [...rows.keys()].sort().reverse();
    const top = this.scroll.getBoundingClientRect().top;
    const active = this.container.ownerDocument.activeElement;
    // Preserve a partly visible entry, including its offset above the viewport.
    let anchor: Item | undefined;
    let offset = 0;
    if (this.scroll.scrollTop > 0) {
      for (const el of this.container.children) {
        const item = this.items.get((el as HTMLElement).dataset.id!);
        if (!item?.row || !rows.has(item.row.id)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom > top) { anchor = item; offset = rect.top; break; }
      }
    }
    for (const [id, item] of this.items) {
      if (!rows.has(id)) {
        this.clearHighlight(item);
        item.el.remove();
        this.items.delete(id);
      }
    }
    let next = this.container.firstElementChild;
    let previousDay = '';
    const now = new Date();
    for (const id of ids) {
      const row = rows.get(id)!;
      const item = this.items.get(id) ?? this.create();
      this.items.set(id, item);
      item.el.dataset.id = id;
      if (item.el !== next) this.container.insertBefore(item.el, next);
      next = item.el.nextElementSibling;
      const date = createdAt(id);
      const key = dayKey(date);
      const divider = key !== previousDay;
      const time = localTime(date);
      const clockChanged = item.clock !== clock;
      if ('text' in row && (item.row !== row || clockChanged)) {
        item.action.setAttribute('aria-label', this.lang.t.more + ' · ' + time);
      }
      if (clockChanged || item.divider.hidden === divider || item.dateKey !== key) {
        item.divider.hidden = !divider;
        if (divider) item.divider.setText(dayLabel(date, now, this.lang));
        item.time.setText(time);
        item.time.setAttribute('datetime', date.toISOString());
        item.dateKey = key;
        item.clock = clock;
      }
      previousDay = key;
      if (item.row === row) {
        if (clockChanged && 'text' in row && row.quote?.status === 'ok' && item.quoteMeta) {
          item.quoteMeta.setText(this.quoteLabel(row.quote.id, now));
        }
        continue;
      }
      item.row = row;
      const { t } = this.lang;
      if ('text' in row) {
        this.fillBody(item.body, row.text);
        item.action.empty();
        setIcon(item.action, 'ellipsis');
        item.action.title = t.more;
        item.action.onclick = () => this.handlers.menu({ id, text: row.text, quoteId: row.quote?.id }, item.action);
        this.renderQuote(item, row, now);
      } else {
        item.body.setText([t.readError, errorDetail(row.error, t)].filter(Boolean).join(' '));
        item.action.setText(t.retry);
        item.action.setAttribute('aria-label', t.retry);
        item.action.title = t.retry;
        item.action.onclick = () => this.handlers.retry(id);
        item.quote?.remove();
        item.quote = undefined;
        item.quoteMeta = undefined;
      }
    }
    if (active && this.container.contains(active) && active !== this.container.ownerDocument.activeElement)
      (active as HTMLElement).focus({ preventScroll: true });
    if (anchor) this.scroll.scrollTop += anchor.el.getBoundingClientRect().top - offset;
  }

  private hasSelection(el: HTMLElement) {
    const selection = this.container.ownerDocument.defaultView?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.toString()) return false;
    return (!!selection.anchorNode && el.contains(selection.anchorNode))
      || (!!selection.focusNode && el.contains(selection.focusNode));
  }

  private fillBody(body: HTMLElement, text: string) {
    body.empty();
    for (const token of tokenizeBody(text)) {
      if (token.type === 'tag') {
        const tag = body.createEl('button', { cls: 'murmline-tag', text: token.value, attr: { type: 'button' } });
        tag.onclick = () => { if (!this.hasSelection(tag)) this.handlers.tag(token.value); };
      } else body.createSpan({ text: token.value });
    }
  }

  private quoteLabel(id: string, now: Date) {
    const date = createdAt(id);
    return dayLabel(date, now, this.lang) + ' ' + localTime(date);
  }

  private renderQuote(item: Item, row: { id: string; text: string; quote?: QuoteSnapshot }, now: Date) {
    item.quote?.remove();
    item.quote = undefined;
    item.quoteMeta = undefined;
    const quote = row.quote;
    if (!quote) return;
    const { t } = this.lang;
    if (quote.status === 'ok') {
      const card = item.el.createEl('button', { cls: 'murmline-quote' , attr: { type: 'button' } });
      item.quoteMeta = card.createDiv({ cls: 'murmline-quote-meta', text: this.quoteLabel(quote.id, now) });
      card.createDiv({ cls: 'murmline-quote-text', text: quote.text });
      card.onclick = () => { if (!this.hasSelection(card)) this.handlers.quote(quote.id); };
      item.quote = card;
    } else if (quote.status === 'missing') {
      const card = item.el.createDiv({ cls: 'murmline-quote is-missing' });
      card.createSpan({ cls: 'murmline-quote-meta', text: t.quoteDeleted });
      item.quote = card;
    } else {
      const card = item.el.createDiv({ cls: 'murmline-quote is-error' });
      card.createSpan({ cls: 'murmline-quote-meta', text: t.quoteFailed });
      const retry = card.createEl('button', { cls: 'murmline-quote-retry', text: t.retry, attr: { type: 'button' } });
      retry.onclick = () => this.handlers.retryQuote(row.id);
      item.quote = card;
    }
  }

  private clearHighlight(item: Item) {
    if (item.highlightTimer !== undefined) {
      this.container.ownerDocument.defaultView?.clearTimeout(item.highlightTimer);
      item.highlightTimer = undefined;
    }
  }

  focus(id: string, preventScroll = true) {
    const item = this.items.get(id);
    item?.action.focus({ preventScroll });
    return !!item;
  }

  reveal(id: string) {
    const item = this.items.get(id);
    if (!item) return false;
    this.clearHighlight(item);
    item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    item.el.classList.remove('is-highlighted');
    void item.el.offsetWidth;
    item.el.classList.add('is-highlighted');
    const win = this.container.ownerDocument.defaultView;
    if (win) {
      item.highlightTimer = win.setTimeout(() => {
        item.highlightTimer = undefined;
        item.el.classList.remove('is-highlighted');
      }, 1200);
    }
    item.action.focus({ preventScroll: true });
    return true;
  }

  clear() {
    for (const item of this.items.values()) this.clearHighlight(item);
  }
}
