import { TestDocument, TestElement } from './ui-fixture';

export class Entry {
  constructor(public path: string) {}
  get name() { return this.path.split('/').pop()!; }
}
export class TFile extends Entry {}
export class TFolder extends Entry {
  children: Entry[] = [];
}

export class Modal {
  contentEl = new TestElement(new TestDocument());
  titleEl = new TestElement(this.contentEl.ownerDocument);
  close() { this.onClose(); }
  onClose() {}
}
export class Scope { register() {} }
export class ItemView {
  contentEl = new TestElement(new TestDocument());
  app = {
    workspace: { onLayoutReady(callback: () => void) { callback(); } },
    vault: { on() {} },
  };
  registerDomEvent() {}
  registerEvent() {}
  registerInterval() {}
}
export function setIcon() {}
