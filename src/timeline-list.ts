import { setIcon } from 'obsidian';
import { errorDetail, type Row } from './feed';
import type { Language } from './i18n';
import { createdAt, dayKey, dayLabel, localTime, type Post } from './post';

type Item = {
  el: HTMLElement; divider: HTMLElement; time: HTMLElement; body: HTMLElement;
  action: HTMLButtonElement; row?: Row; dateKey?: string; clock?: string;
};

export class TimelineList {
  private items = new Map<string, Item>();
  constructor(private container: HTMLElement, private scroll: HTMLElement, private lang: Language,
    private menu: (post: Post, button: HTMLButtonElement) => void, private retry: (id: string) => void) {}

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
      if (!rows.has(id)) { item.el.remove(); this.items.delete(id); }
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
      if ('text' in row && (item.row !== row || item.clock !== clock)) {
        item.action.setAttribute('aria-label', this.lang.t.more + ' · ' + time);
      }
      if (item.clock !== clock || item.divider.hidden === divider || item.dateKey !== key) {
        item.divider.hidden = !divider;
        if (divider) item.divider.setText(dayLabel(date, now, this.lang));
        item.time.setText(time);
        item.time.setAttribute('datetime', date.toISOString());
        item.dateKey = key;
        item.clock = clock;
      }
      previousDay = key;
      if (item.row === row) continue;
      item.row = row;
      const { t } = this.lang;
      if ('text' in row) {
        item.body.setText(row.text);
        item.action.empty();
        setIcon(item.action, 'ellipsis');
        item.action.title = t.more;
        item.action.onclick = () => this.menu(row, item.action);
      } else {
        item.body.setText([t.readError, errorDetail(row.error, t)].filter(Boolean).join(' '));
        item.action.setText(t.retry);
        item.action.setAttribute('aria-label', t.retry);
        item.action.title = t.retry;
        item.action.onclick = () => this.retry(id);
      }
    }
    if (active && this.container.contains(active) && active !== this.container.ownerDocument.activeElement)
      (active as HTMLElement).focus({ preventScroll: true });
    if (anchor) this.scroll.scrollTop += anchor.el.getBoundingClientRect().top - offset;
  }

  focus(id: string, preventScroll = true) {
    const item = this.items.get(id);
    item?.action.focus({ preventScroll });
    return !!item;
  }
}
