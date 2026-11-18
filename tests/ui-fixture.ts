// Only the host operations used by the timeline. Hiding or disabling a focused
// button clears focus so a test cannot pass by focusing a detached control.
export class TestDocument {
  activeElement: TestElement | null = null;
  defaultView = { setInterval: () => 0 };
}
type Options = { cls?: string; text?: string; attr?: Record<string, string> };
export class TestElement {
  children: TestElement[] = [];
  parent?: TestElement;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  textContent = '';
  value = '';
  scrollTop = 0;
  onclick?: (event: {detail: number}) => void;
  private invisible = false;
  private inactive = false;

  constructor(readonly ownerDocument: TestDocument, readonly cls = '') {}
  get hidden() { return this.invisible; }
  set hidden(value: boolean) {
    this.invisible = value;
    if (value && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
  }
  get disabled() { return this.inactive; }
  set disabled(value: boolean) {
    this.inactive = value;
    if (value && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
  }
  focus() { if (!this.hidden && !this.disabled) this.ownerDocument.activeElement = this; }
  click(detail = 0) { if (!this.hidden && !this.disabled) this.onclick?.({ detail }); }
  createEl(_tag: string, options: Options = {}) {
    const child = new TestElement(this.ownerDocument, options.cls);
    child.textContent = options.text ?? '';
    child.attributes = new Map(Object.entries(options.attr ?? {}));
    this.insertBefore(child, null);
    return child;
  }
  createDiv(options?: Options) { return this.createEl('div', options); }
  createSpan(options?: Options) { return this.createEl('span', options); }
  addClass() {}
  toggleClass() {}
  empty() { this.children = []; this.textContent = ''; }
  setText(value: string) { this.textContent = value; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getBoundingClientRect() { return { top: 0, bottom: 20 }; }
  get firstElementChild(): TestElement | null { return this.children[0] ?? null; }
  get nextElementSibling(): TestElement | null {
    return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null;
  }
  insertBefore(child: TestElement, next: TestElement | null) {
    if (child === next) return;
    child.remove();
    child.parent = this;
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
  contains(node: TestElement | null): boolean {
    return this === node || this.children.some(child => child.contains(node));
  }
  find(predicate: (el: TestElement) => boolean): TestElement | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
  }
}
