import {DesignerAppHostError} from './designer-app-host-errors.js';

function childrenOf(node) {
  const children = [];
  if (node.templateRoot) children.push(node.templateRoot);
  for (const [name, value] of Object.entries(node.properties ?? {})) {
    if (!['Style', 'Template', 'VisualTree'].includes(name) && value?.$ref) children.push(value.$ref);
  }
  for (const values of Object.values(node.collections ?? {})) {
    for (const value of values) if (value?.$ref) children.push(value.$ref);
  }
  return children;
}

/** Build a bounded runtime outline in O(nodes + references), retaining actual runtime ids. */
export function appRuntimeTree(nodes, windows) {
  if (!(nodes instanceof Map) || nodes.size > 20_000 || !Array.isArray(windows) || windows.length > 20_000) {
    throw new DesignerAppHostError('Runtime visual tree exceeds the host limit', 'SFDA0014');
  }
  const visited = new Set();
  const visit = (id, depth) => {
    const node = nodes.get(id);
    if (!node || visited.has(id)) return null;
    if (depth > 128) throw new DesignerAppHostError('Runtime visual tree exceeds 128 levels', 'SFDA0014');
    visited.add(id);
    const type = node.type?.split('.').at(-1) ?? 'Object';
    const name = node.properties?.Name || node.properties?.Title;
    return {
      id, runtimeId: id, label: name ? `${type} · ${String(name).slice(0,256)}` : type,
      description: `${type} (${id})`, defaultExpanded: depth < 3,
      children: childrenOf(node).map(child => visit(child, depth + 1)).filter(Boolean)
    };
  };
  return windows.map(id => visit(id, 1)).filter(Boolean);
}

export function appWindowDescriptors(nodes, windows) {
  return windows.filter(id => nodes.has(id)).map(id => ({id, title: String(nodes.get(id).properties?.Title || 'WinUI Window').slice(0, 256)}));
}
