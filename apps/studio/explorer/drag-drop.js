import {requireDropTarget} from './guards.js';

/** Adds linked-item and OS-file drops without changing the shared tree control's native selection/drag behavior. */
export class ExplorerDragDrop {
  constructor({element, model, treeId, onCommand, onError}) {
    Object.assign(this, {element, model, treeId, onCommand, onError});
    this.over = event => this.dragOver(event);
    this.dropEvent = event => this.drop(event).catch(error => onError?.(error));
    element.addEventListener('dragover', this.over, true);
    element.addEventListener('drop', this.dropEvent, true);
  }

  target(event) {
    const element = event.target.closest?.('[data-tree-id]');
    return element && this.element.contains(element) ? this.model.nodes.get(element.dataset.treeId) : null;
  }

  owns(event) {
    const types = [...(event.dataTransfer?.types ?? [])];
    return types.includes('Files') || (event.ctrlKey || event.metaKey) && event.shiftKey && types.includes('application/x-sharpforge-tree');
  }

  dragOver(event) {
    if (!this.owns(event)) return;
    event.stopImmediatePropagation();
    try {
      requireDropTarget(this.target(event));
      event.preventDefault();
      event.dataTransfer.dropEffect = event.shiftKey && (event.ctrlKey || event.metaKey) ? 'link' : 'copy';
    } catch { event.dataTransfer.dropEffect = 'none'; }
  }

  async drop(event) {
    if (!this.owns(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = this.target(event);
    requireDropTarget(target);
    if ([...event.dataTransfer.types].includes('Files')) {
      const files = [...event.dataTransfer.files];
      if (!files.length) throw new Error('Directory drops are unsupported; choose a folder workspace explicitly');
      return this.onCommand('import-drop', target, [], {files});
    }
    const raw = event.dataTransfer.getData('application/x-sharpforge-tree');
    if (raw.length > 1_000_000) throw new Error('Tree drag payload exceeds limit');
    const data = JSON.parse(raw);
    if (data.tree !== this.treeId || !Array.isArray(data.ids)) throw new Error('Items must come from this explorer');
    const nodes = data.ids.map(id => this.model.nodes.get(id));
    if (nodes.some(node => !node)) throw new Error('A dragged item no longer exists');
    return this.onCommand('link-to', target, nodes);
  }

  dispose() {
    this.element.removeEventListener('dragover', this.over, true);
    this.element.removeEventListener('drop', this.dropEvent, true);
  }
}
