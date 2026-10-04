import {TreeModel, TreeView} from '@sharpforge/controls';
import {element, input, runAction} from '../ui.js';

/** Shared accessible tree host; provider-specific meaning stays in each tool adapter. */
export function createToolTree(host, {label, onOpen = () => {}, onSelect = () => {}, onExpand, onDrop, onError}) {
  const document = host.ownerDocument;
  const toolbar = element(document, 'div', {className: 'wb-tool-controls'});
  const area = element(document, 'div', {className: 'wb-tree-host'});
  const details = element(document, 'pre', {className: 'wb-preview', 'aria-label': label + ' details'});
  const status = element(document, 'p', {className: 'wb-tool-status', role: 'status'});
  const model = new TreeModel();
  toolbar.append(input(document, 'Search ' + label, '', query => model.setFilter(query)));
  host.replaceChildren(toolbar, area, details, status);
  const view = new TreeView(area, {model, label, rowHeight: 28, onOpen: runAction(onOpen, onError),
    onSelect: nodes => {
      const selected = nodes[0];
      details.textContent = selected?.detail ?? selected?.label ?? '';
      onSelect(selected);
    }, onExpand, onDrop, onError});
  return {toolbar, area, details, status, model, view,
    setNodes: nodes => model.setNodes(nodes), dispose: () => view.dispose()};
}

export function hierarchicalSymbols(symbols, {includeMembers = true, includePrivate = true} = {}) {
  const projects = new Map();
  const types = new Map();
  for (const symbol of symbols) {
    if (['local', 'parameter'].includes(symbol.kind) || symbol.name?.startsWith('<')) continue;
    if (!includePrivate && (symbol.accessibility === 'private' || symbol.modifiers?.includes('private'))) continue;
    const projectId = symbol.projectId ?? '(workspace)';
    let project = projects.get(projectId);
    if (!project) projects.set(projectId, project = {id: 'project:' + projectId, label: projectId, children: [], defaultExpanded: true});
    if (['class', 'struct', 'interface', 'enum', 'record', 'namespace'].includes(symbol.kind)) {
      const namespace = symbol.namespace ?? (symbol.qualifiedName?.includes('.') ? symbol.qualifiedName.split('.').slice(0, -1).join('.') : '');
      let parent = project;
      if (namespace) {
        const id = project.id + ':namespace:' + namespace;
        parent = project.children.find(item => item.id === id);
        if (!parent) project.children.push(parent = {id, label: namespace, children: [], defaultExpanded: true});
      }
      const node = {id: 'symbol:' + symbol.id, label: symbol.name, detail: symbol.detail ?? symbol.name,
        symbol, children: [], defaultExpanded: false};
      parent.children.push(node);
      types.set(projectId + ':' + symbol.name, node);
      if (symbol.qualifiedName) types.set(projectId + ':' + symbol.qualifiedName, node);
    }
  }
  if (includeMembers) for (const symbol of symbols) {
    if (!['method', 'property', 'field', 'event', 'constructor'].includes(symbol.kind)) continue;
    if (!includePrivate && (symbol.accessibility === 'private' || symbol.modifiers?.includes('private'))) continue;
    const projectId = symbol.projectId ?? '(workspace)';
    const parent = types.get(projectId + ':' + symbol.owner) ?? projects.get(projectId);
    parent?.children.push({id: 'symbol:' + symbol.id, label: symbol.name, detail: symbol.detail, symbol, children: []});
  }
  return [...projects.values()];
}
