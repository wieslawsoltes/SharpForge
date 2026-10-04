import {parseXml} from '@sharpforge/project-system';

function workspaceRelative(value, root) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value)) return null;
  const path = String(value).replaceAll('\\', '/');
  const prefix = root?.replaceAll('\\', '/').replace(/\/$/, '');
  let relative = prefix && path.toLowerCase().startsWith(prefix.toLowerCase() + '/') ? path.slice(prefix.length + 1) : path;
  if (/^(?:\/|[a-z]:)/i.test(relative)) return null;
  const parts = [];
  for (const part of relative.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  relative = parts.join('/');
  return relative || null;
}

function integer(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid coverage ' + label);
  return result;
}

/** Cobertura line/branch coverage with de-duplicated source lines and explicit diagnostics for external paths. */
export function parseCobertura(source, options = {}) {
  const {workspaceRoot = '', signal, maxLines = 1_000_000} = options;
  const root = parseXml(source, {maxLength: 32_000_000, maxNodes: maxLines * 4, maxDepth: 128});
  if (root.name.split(':').at(-1) !== 'coverage') throw new Error('Expected Cobertura coverage root');
  const files = new Map();
  const diagnostics = [];
  let count = 0;
  const visit = (node, file = null) => {
    signal?.throwIfAborted();
    const name = node.name.split(':').at(-1);
    if (name === 'class') {
      const path = workspaceRelative(node.attributes.filename, workspaceRoot);
      if (!path) {
        diagnostics.push({code: 'SFT2302', severity: 'warning', message: 'Coverage file lies outside the workspace', path: node.attributes.filename});
        return;
      }
      if (!files.has(path)) files.set(path, {path, lines: new Map()});
      file = files.get(path);
    }
    if (name === 'line' && file) {
      if (++count > maxLines) throw new Error('Coverage line limit exceeded');
      const number = integer(node.attributes.number, 'line number');
      if (!number) throw new Error('Coverage lines are one-based');
      const hits = integer(node.attributes.hits, 'hit count');
      const branch = node.attributes.branch === 'true';
      const match = /\((\d+)\/(\d+)\)/.exec(node.attributes['condition-coverage'] ?? '');
      if (branch && !match) throw new Error('Branch line requires condition coverage counts');
      const coveredBranches = match ? integer(match[1], 'covered branches') : 0;
      const totalBranches = match ? integer(match[2], 'total branches') : 0;
      if (coveredBranches > totalBranches) throw new Error('Invalid branch coverage counts');
      const old = file.lines.get(number);
      file.lines.set(number, {number, hits: Math.max(old?.hits ?? 0, hits),
        coveredBranches: Math.max(old?.coveredBranches ?? 0, coveredBranches), totalBranches: Math.max(old?.totalBranches ?? 0, totalBranches)});
    }
    for (const child of node.children) visit(child, file);
  };
  visit(root);
  const result = [...files.values()].sort((left, right) => left.path.localeCompare(right.path)).map(file => ({path: file.path,
    lines: [...file.lines.values()].sort((left, right) => left.number - right.number)}));
  return {format: 'cobertura', files: result, diagnostics, coveredLines: result.reduce((sum, file) => sum +
    file.lines.filter(line => line.hits > 0).length, 0), totalLines: result.reduce((sum, file) => sum + file.lines.length, 0)};
}
