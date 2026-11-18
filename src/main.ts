import { getLanguage, Notice, Plugin } from 'obsidian';
import { language } from './i18n';
import { PostStore } from './post-store';
import { TimelineView, VIEW } from './timeline-view';

export default class Murmline extends Plugin {
  private opening?: Promise<void>;

  override onload() {
    const store = new PostStore(this.app);
    const lang = language(getLanguage());
    this.registerView(VIEW, leaf => new TimelineView(leaf, store, lang));
    const capture = () => {
      this.opening ??= this.openTimeline().catch(() => { new Notice(lang.t.openError); })
        .finally(() => { this.opening = undefined; });
      return this.opening;
    };
    this.addCommand({ id: 'capture-thought', name: lang.t.capture, callback: capture });
    this.addRibbonIcon('feather', lang.t.capture, capture);
  }

  private async openTimeline() {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof TimelineView) leaf.view.focusComposer();
  }
}
