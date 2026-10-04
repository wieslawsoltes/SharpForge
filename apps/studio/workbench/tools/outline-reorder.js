import {cancellable} from '../events.js';
import {button, runAction} from '../ui.js';

/** Owns one versioned provider edit; a moved caret, project or source version cannot retarget it. */
export class OutlineReorder {
  constructor({request, documents, context, applyEdits, navigate}) {
    Object.assign(this, {request, documents, context, applyEdits, navigate});
    this.controller = null;
    this.disposed = false;
  }

  async move(source, target, position = 'before') {
    if (this.disposed) throw new Error('Outline was closed');
    if (!this.applyEdits) throw new Error('The current workspace does not provide versioned source edits');
    if (!source?.symbol || !target?.symbol || source.symbol.uri !== target.symbol.uri) {
      throw new Error('Choose two source members in the same document');
    }
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    const current = this.context(), uri = source.symbol.uri, file = this.documents.get(uri);
    if (!file || file.readOnly || current.readOnly || file.version !== source.symbol.version || file.version !== target.symbol.version) {
      throw new Error('Source is read-only or changed; refresh the outline');
    }
    const version = file.version, projectId = current.projectId, workspaceEpoch = current.workspaceEpoch;
    const action = await cancellable(this.request('outlineReorder', {uri, version, projectId,
      sourceStart: source.symbol.start, targetStart: target.symbol.start, position}, {signal: controller.signal}), controller.signal);
    if (controller.signal.aborted || this.disposed) return false;
    const latest = this.context();
    if (this.documents.get(uri) !== file || file.version !== version || latest.projectId !== projectId ||
        latest.workspaceEpoch !== workspaceEpoch || latest.uri !== uri) {
      throw new Error('Source or active project changed while preparing the reorder');
    }
    if (!action || action.version !== version || !Array.isArray(action.edits) || action.edits.some(edit => edit.uri !== uri || edit.version !== version)) {
      throw new Error('The reorder provider returned an invalid or stale edit');
    }
    if (!action.edits.length) return false;
    await this.applyEdits(action.edits, {title: action.title});
    if (!this.disposed && this.context().projectId === projectId && action.selection) await this.navigate?.(action.selection);
    return true;
  }

  dispose() {
    this.disposed = true;
    this.controller?.abort();
  }
}

/** Leaf rows accept before/after drops without pretending to contain child nodes. */
export function installOutlineDrops(tree, {isCode, move, onError}) {
  let target = null;
  const row = event => {
    const element = event.target.closest?.('[data-tree-id]');
    const node = tree.model.nodes.get(element?.dataset.treeId);
    return element && node?.symbol ? {element, node} : null;
  };
  const over = event => {
    const selected = row(event);
    if (!isCode() || !selected || !event.dataTransfer?.types.includes('application/x-sharpforge-tree')) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = selected.element.getBoundingClientRect();
    target = {...selected, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'};
    event.dataTransfer.dropEffect = 'move';
    tree.status.textContent = `Move ${target.position} ${selected.node.label}`;
  };
  const drop = async event => {
    if (!isCode() || !target || row(event)?.node !== target.node) return;
    event.preventDefault();
    event.stopPropagation();
    const destination = target;
    target = null;
    try {
      const text = event.dataTransfer.getData('application/x-sharpforge-tree');
      if (text.length > 100_000) throw new Error('Outline drag payload exceeds its limit');
      const data = JSON.parse(text);
      if (data.tree !== tree.view.id || !Array.isArray(data.ids) || data.ids.length !== 1) throw new Error('Move one member from this outline');
      await move(tree.model.nodes.get(data.ids[0]), destination.node, destination.position);
    } catch (error) { if (error.name !== 'AbortError') onError(error); }
  };
  const leave = () => { target = null; };
  const leaveArea = event => { if (!tree.area.contains(event.relatedTarget)) leave(); };
  tree.area.addEventListener('dragover', over, true);
  tree.area.addEventListener('drop', drop, true);
  tree.area.addEventListener('dragend', leave);
  tree.area.addEventListener('dragleave', leaveArea);
  return () => {
    tree.area.removeEventListener('dragover', over, true);
    tree.area.removeEventListener('drop', drop, true);
    tree.area.removeEventListener('dragend', leave);
    tree.area.removeEventListener('dragleave', leaveArea);
  };
}

/** Keyboard and toolbar routes share the exact same guarded source move as drag and drop. */
export function installOutlineActions(tree, {isCode, move, onError}) {
  const moveSibling = async direction => {
    if (!isCode()) throw new Error('Use designer reparenting for the visual tree');
    const selected = tree.model.nodes.get(tree.model.focused);
    const parent = tree.model.nodes.get(tree.model.parents.get(selected?.id));
    const siblings = (parent?.children ?? []).filter(node => node.symbol);
    const target = siblings[siblings.indexOf(selected) + direction];
    if (selected && target) await move(selected, target, direction < 0 ? 'before' : 'after');
  };
  const keyboard = event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    runAction(() => moveSibling(event.key === 'ArrowUp' ? -1 : 1), onError)();
  };
  tree.area.addEventListener('keydown', keyboard, true);
  const document = tree.area.ownerDocument;
  tree.toolbar.append(button(document, 'Move up', runAction(() => moveSibling(-1), onError)),
    button(document, 'Move down', runAction(() => moveSibling(1), onError)));
  return () => tree.area.removeEventListener('keydown', keyboard, true);
}
