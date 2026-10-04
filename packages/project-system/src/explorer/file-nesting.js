import {baseName, directoryName} from '../paths.js';

function inferredParent(path, names) {
  const name = baseName(path);
  const base = directoryName(path);
  const sibling = value => (base ? base + '/' : '') + value;
  const candidates = [];
  if (/\.xaml\.cs$/i.test(name)) candidates.push(name.slice(0, -3));
  if (/\.(?:Designer|g|g\.i)\.cs$/i.test(name)) {
    const stem = name.replace(/\.(?:Designer|g|g\.i)\.cs$/i, '');
    candidates.push(stem + '.resx', stem + '.xaml', stem + '.cs');
  }
  if (/^appsettings\..+\.json$/i.test(name)) candidates.push('appsettings.json');
  if (/^.+\.[^.]+\.cs$/i.test(name)) candidates.push(name.replace(/\.[^.]+\.cs$/i, '.cs'));
  return candidates.map(sibling).find(candidate => names.has(candidate));
}

/** Move display nodes under related files without changing their identities or physical paths. Cycles remain flat. */
export function applyFileNesting(projectNode, {enabled = true} = {}) {
  if (!enabled) return projectNode;
  const files = new Map();
  const parents = new Map();
  const walk = parent => {
    for (const child of parent.children ?? []) {
      if (child.path && ['source', 'file', 'assembly'].includes(child.kind)) {
        files.set(child.path, child);
        parents.set(child.path, parent);
      }
      if (child.kind === 'folder') walk(child);
    }
  };
  walk(projectNode);
  const targets = new Map();
  for (const [path, node] of files) {
    const dependent = node.metadata?.DependentUpon;
    const target = dependent ? (directoryName(path) ? directoryName(path) + '/' : '') + dependent : inferredParent(path, files);
    if (target && target !== path && files.has(target)) targets.set(path, target);
  }
  for (const [path, target] of targets) {
    let cursor = target;
    const visited = new Set([path]);
    while (cursor && !visited.has(cursor)) { visited.add(cursor); cursor = targets.get(cursor); }
    if (cursor) continue;
    const node = files.get(path);
    const parent = parents.get(path);
    parent.children.splice(parent.children.indexOf(node), 1);
    const owner = files.get(target);
    owner.children ??= [];
    owner.children.push(node);
    owner.branch = true;
    node.nested = true;
  }
  return projectNode;
}
