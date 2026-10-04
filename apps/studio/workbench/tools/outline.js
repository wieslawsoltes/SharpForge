import {createToolTree, hierarchicalSymbols} from './tree-host.js';
import {button, checkbox, runAction} from '../ui.js';
import {cancellable} from '../events.js';
import {OutlineReorder, installOutlineDrops, installOutlineActions} from './outline-reorder.js';

function outlineNodes(symbols, file, alphabetical) {
  const nodes = hierarchicalSymbols(symbols.map(symbol => ({...symbol, uri: file.uri, version: file.version})));
  const prepare = children => {
    children.sort((left, right) => alphabetical ? left.label.localeCompare(right.label) :
      (left.symbol?.bodyStart ?? left.symbol?.start ?? 0) - (right.symbol?.bodyStart ?? right.symbol?.start ?? 0));
    for (const node of children) {
      node.draggable = !file.readOnly && !alphabetical && ['method', 'constructor', 'property'].includes(node.symbol?.kind);
      prepare(node.children);
    }
  };
  prepare(nodes);
  return nodes;
}

function followOutline(tree, selection) {
  const candidates = [...tree.model.nodes.values()].filter(node => node.symbol && node.symbol.uri === selection.uri &&
    (node.symbol.bodyStart ?? node.symbol.start) <= selection.offset && (node.symbol.bodyEnd ?? node.symbol.end) >= selection.offset);
  candidates.sort((left, right) => (left.symbol.bodyEnd ?? left.symbol.end) - (left.symbol.bodyStart ?? left.symbol.start) -
    ((right.symbol.bodyEnd ?? right.symbol.end) - (right.symbol.bodyStart ?? right.symbol.start)));
  if (!candidates[0]) return;
  tree.model.selected = new Set([candidates[0].id]);
  for (const ancestor of tree.model.ancestors(candidates[0].id)) tree.model.expanded.add(ancestor);
  tree.model.notify();
}

export function mountOutline(host, {request, context, documents, navigate, designer, applyEdits, onError}) {
  let generation = 0, alphabetical = false, followCaret = true;
  let controller;
  const reorder = new OutlineReorder({request, documents, context, applyEdits, navigate});
  const isCode = () => context().activeDocumentKind !== 'designer';
  const move = async (source, target, position) => {
    if (alphabetical) throw new Error('Turn off Alphabetical sorting before reordering declarations');
    try { if (await reorder.move(source, target, position)) await refresh(); }
    catch (error) { if (error.name !== 'AbortError') throw error; }
  };
  const tree = createToolTree(host, {label: 'Document Outline', onError,
    onOpen: node => node.designId ? designer()?.document.select(node.designId) : node.symbol && navigate(node.symbol),
    onDrop: async (nodes, target) => {
      if (isCode()) {
        if (nodes.length !== 1) throw new Error('Move one source member at a time');
        return move(nodes[0], target, 'before');
      }
      const model = designer()?.document;
      if (!model) throw new Error('No designer document is active');
      for (const node of nodes) model.move(node.designId, target.designId);
    }});
  const removeDrops = installOutlineDrops(tree, {isCode, move, onError});
  const removeActions = installOutlineActions(tree, {isCode, move, onError});
  const refresh = runAction(async () => {
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    const selection = context();
    if (selection.activeDocumentKind === 'designer' && designer()?.document) {
      const model = designer().document;
      const visit = id => {
        const node = model.node(id);
        return {id: 'design:' + id, designId: id, label: node.properties.Name ?? node.type.split('.').at(-1),
          detail: node.type, children: node.children.map(visit), draggable: id !== model.value.root, dropTarget: true, defaultExpanded: true};
      };
      tree.setNodes([visit(model.value.root)]);
      return;
    }
    const file = documents.get(selection.uri);
    if (!file) { tree.setNodes([]); return; }
    const version = file.version;
    try {
      const symbols = await cancellable(request('symbols', {uri: file.uri}), controller.signal);
      if (current !== generation || documents.get(file.uri)?.version !== version) return;
      tree.setNodes(outlineNodes(symbols, file, alphabetical));
      tree.status.textContent = 'Drag a member before or after another, or use Alt+Up / Alt+Down. Unsafe moves are rejected.';
      follow();
    } catch (error) { if (error.name !== 'AbortError') throw error; }
  }, onError);
  const follow = () => { if (followCaret) followOutline(tree, context()); };
  tree.toolbar.append(button(host.ownerDocument, 'Refresh', refresh),
    checkbox(host.ownerDocument, 'Follow caret', followCaret, value => { followCaret = value; follow(); }),
    checkbox(host.ownerDocument, 'Alphabetical', alphabetical, value => { alphabetical = value; refresh(); }));
  refresh();
  return {refresh, follow, dispose: () => {
    controller?.abort(); reorder.dispose(); removeDrops(); removeActions();
    tree.dispose();
  }};
}
