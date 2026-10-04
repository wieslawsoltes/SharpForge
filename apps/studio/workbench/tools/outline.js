import {createToolTree, hierarchicalSymbols} from './tree-host.js';
import {button, checkbox, select, runAction} from '../ui.js';
import {cancellable} from '../events.js';

export function mountOutline(host, {request, context, documents, navigate, designer, onError}) {
  let generation = 0, alphabetical = false, followCaret = true;
  let controller;
  const tree = createToolTree(host, {label: 'Document Outline', onError,
    onOpen: node => node.designId ? designer()?.document.select(node.designId) : node.symbol && navigate(node.symbol),
    onDrop: (nodes, target) => {
      const model = designer()?.document;
      if (context().activeDocumentKind !== 'designer' || !model) throw new Error('Code reorder requires a semantic refactoring provider');
      for (const node of nodes) model.move(node.designId, target.designId);
    }});
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
      if (alphabetical) symbols.sort((left, right) => left.name.localeCompare(right.name));
      tree.setNodes(hierarchicalSymbols(symbols.map(symbol => ({...symbol, uri: file.uri, version}))));
      follow();
    } catch (error) { if (error.name !== 'AbortError') throw error; }
  }, onError);
  const follow = () => {
    if (!followCaret) return;
    const selection = context();
    const candidates = [...tree.model.nodes.values()].filter(node => node.symbol && node.symbol.uri === selection.uri &&
      (node.symbol.bodyStart ?? node.symbol.start) <= selection.offset && (node.symbol.bodyEnd ?? node.symbol.end) >= selection.offset);
    candidates.sort((left, right) => (left.symbol.bodyEnd ?? left.symbol.end) - (left.symbol.bodyStart ?? left.symbol.start) -
      ((right.symbol.bodyEnd ?? right.symbol.end) - (right.symbol.bodyStart ?? right.symbol.start)));
    if (candidates[0]) {
      tree.model.selected = new Set([candidates[0].id]);
      for (const ancestor of tree.model.ancestors(candidates[0].id)) tree.model.expanded.add(ancestor);
      tree.model.notify();
    }
  };
  tree.toolbar.append(button(host.ownerDocument, 'Refresh', refresh),
    checkbox(host.ownerDocument, 'Follow caret', followCaret, value => { followCaret = value; follow(); }),
    checkbox(host.ownerDocument, 'Alphabetical', alphabetical, value => { alphabetical = value; refresh(); }));
  refresh();
  return {refresh, follow, dispose: () => { controller?.abort(); tree.dispose(); }};
}
