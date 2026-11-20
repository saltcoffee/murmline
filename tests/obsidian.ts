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
    metadataCache: { on() {} },
  };
  registerDomEvent() {}
  registerEvent() {}
  registerInterval() {}
}
export function setIcon() {}

export function getFrontMatterInfo(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  return { exists: !!match, contentStart: match?.[0].length ?? 0, frontmatter: match?.[1] ?? '' };
}
export function parseYaml(source: string) {
  const match = /^murmline-created: (\d+)$/m.exec(source);
  return match ? { 'murmline-created': Number(match[1]) } : {};
}
