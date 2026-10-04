import {explorerNodeId} from './node-identity.js';
import {symbolOwners} from './symbol-ownership.js';

const typeKinds = new Set(['class', 'struct', 'interface', 'record', 'record-struct', 'enum', 'delegate']);
const memberKinds = new Set(['method', 'field', 'property', 'event', 'constructor', 'enum-member', 'operator', 'indexer']);
const icons = {class: 'C', struct: 'S', interface: 'I', record: 'R', 'record-struct': 'R', enum: 'E', delegate: 'D',
  event: 'ϟ', constructor: '◇', method: '◇', property: '⚙', field: '▪', 'enum-member': '▪', operator: '±', indexer: '[]'};

/** Build every supported type/member kind using owner identity first, then containing source span. */
export function buildSymbolChildren(file, symbols, {maxSymbols = 5000} = {}) {
  const values = symbols.filter(symbol => (typeKinds.has(symbol.kind) || memberKinds.has(symbol.kind)) &&
    !symbol.name?.startsWith('<')).slice(0, maxSymbols);
  const nodes = [];
  const byId = new Map();
  const byName = new Map();
  const pairs = values.map(symbol => {
    const constructor = symbol.kind === 'constructor' || symbol.name === '.ctor';
    const method = constructor || symbol.kind === 'method' || symbol.kind === 'operator';
    const identity = String(symbol.id ?? [symbol.kind, symbol.owner ?? '', symbol.name, symbol.start ?? 0].join(':'));
    const node = {id: explorerNodeId('symbol', file.id, identity), kind: 'symbol', symbolKind: symbol.kind,
      label: (constructor ? symbol.owner?.split('.').at(-1) ?? file.label : symbol.name) +
        (method ? '(' + (symbol.parameters ?? []).map(parameter => parameter.type).join(', ') + ')' : '') +
        (!typeKinds.has(symbol.kind) && symbol.type ? ' : ' + symbol.type : ''),
      path: file.path, start: symbol.start, end: symbol.end, symbol, draggable: false, icon: icons[symbol.kind] ?? '◇', children: []};
    if (typeKinds.has(symbol.kind)) {
      if (symbol.id !== undefined) byId.set(symbol.id, node);
      const list = byName.get(symbol.name) ?? [];
      list.push(node);
      byName.set(symbol.name, list);
      if (symbol.fullName) byName.set(symbol.fullName, [node]);
    }
    return {symbol, node};
  });
  const {parents, cyclic} = symbolOwners(pairs, typeKinds, byId, byName);
  for (const {node} of pairs) {
    const owner = parents.get(node);
    (owner?.children ?? nodes).push(node);
    if (owner) owner.branch = true;
  }
  if (cyclic) nodes.push({id: file.id + ':symbols:cycle', kind: 'diagnostic', label: 'Cyclic symbol ownership',
    diagnostic: {code: 'SFP2404', message: 'Invalid cyclic symbol metadata was detached from the hierarchy'}, draggable: false});
  if (symbols.length > maxSymbols) nodes.push({id: file.id + ':symbols:limit', kind: 'diagnostic', label: 'Symbol limit exceeded',
    badge: '⚠', diagnostic: {code: 'SFP2403', message: 'Only the first ' + maxSymbols + ' symbols are displayed'}, draggable: false});
  return nodes;
}

/** Attach a lazy materializer; collapsed files allocate no symbol nodes. */
export function attachLazySymbols(root, symbols, {expanded = new Set()} = {}) {
  const files = new Map();
  for (const symbol of symbols) {
    if (!symbol.uri) continue;
    const list = files.get(symbol.uri) ?? [];
    list.push(symbol);
    files.set(symbol.uri, list);
  }
  const visit = node => {
    if (node.kind === 'source' && files.has(node.path)) {
      const values = files.get(node.path);
      const physical = [...(node.children ?? [])];
      for (const child of physical) visit(child);
      node.branch = true;
      node.loadChildren = () => [...physical, ...buildSymbolChildren(node, values)];
      if (expanded.has(node.id)) node.children = node.loadChildren();
      return;
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return root;
}
