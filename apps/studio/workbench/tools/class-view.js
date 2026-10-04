import {createToolTree, hierarchicalSymbols} from './tree-host.js';
import {button, checkbox, element, runAction} from '../ui.js';

export function mountClassView(host, {symbolIndex, navigate, onError}) {
  let controller;
  let members = true, privateMembers = true;
  let symbols = [];
  const tree = createToolTree(host, {label: 'Class View', onError,
    onOpen: node => node.symbol ? navigate(node.symbol) : undefined,
    onSelect: node => {
      if (!node?.symbol) return;
      const symbol = node.symbol;
      const bases = symbol.baseTypes ?? (symbol.baseType ? [symbol.baseType] : []);
      const derived = symbols.filter(item => item.baseType === symbol.name || item.baseTypes?.includes(symbol.name));
      tree.details.textContent = (symbol.detail ?? symbol.name) + '\nBase types: ' + (bases.join(', ') || 'none reported') +
        '\nDerived types: ' + (derived.map(item => item.name).join(', ') || 'none reported');
    }});
  const render = () => tree.setNodes(hierarchicalSymbols(symbols, {includeMembers: members, includePrivate: privateMembers}));
  const refresh = runAction(async () => {
    controller?.abort();
    controller = new AbortController();
    try {
      symbols = await symbolIndex.query('', {signal: controller.signal});
      render();
      tree.status.textContent = symbols.length + ' workspace symbols';
    } catch (error) { if (error.name !== 'AbortError') throw error; }
  }, onError);
  tree.toolbar.append(button(host.ownerDocument, 'Refresh', refresh));
  tree.toolbar.append(checkbox(host.ownerDocument, 'Members', members, value => { members = value; render(); }));
  tree.toolbar.append(checkbox(host.ownerDocument, 'Private members', privateMembers, value => { privateMembers = value; render(); }));
  refresh();
  return {refresh, dispose: () => { controller?.abort(); tree.dispose(); }};
}
