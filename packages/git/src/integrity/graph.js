import { checkCancelled, checkLimit } from '../errors.js';
import { IntegrityCategory as Category } from './report.js';

/** Check target types and graph cycles with iterative DFS, so repository depth cannot exhaust the call stack. */
export function verifyIntegrityGraph(nodes, roots, report, options) {
  const incoming = new Map();
  for (const node of nodes.values()) {
    if (!node) continue;
    for (const link of node.links) {
      if (link.external) continue;
      incoming.set(link.oid, (incoming.get(link.oid) ?? 0) + 1);
      verifyLink(link, nodes, report, { source: node.oid });
    }
  }
  for (const root of roots) verifyLink(root, nodes, report, { ref: root.ref });
  detectCycles(nodes, report, options);
  const reachable = new Set();
  const pending = roots.map(root => root.oid);
  while (pending.length) {
    checkCancelled(options.signal);
    const oid = pending.pop();
    if (reachable.has(oid)) continue;
    const node = nodes.get(oid);
    if (!node) continue;
    reachable.add(oid);
    for (const link of node.links) if (!link.external) pending.push(link.oid);
  }
  let unreachable = 0;
  let dangling = 0;
  for (const node of nodes.values()) {
    if (!node || reachable.has(node.oid)) continue;
    unreachable++;
    if (!incoming.has(node.oid)) {
      dangling++;
      if (options.reportUnreachable !== false) report.add(Category.Dangling, 'Object is not reachable from repository roots',
        { oid: node.oid, type: node.type }, 'warning');
    } else if (options.reportUnreachable === 'all') report.add(Category.Unreachable, 'Object is unreachable',
      { oid: node.oid, type: node.type }, 'warning');
  }
  return { reachable: reachable.size, unreachable, dangling };
}

function verifyLink(link, nodes, report, details) {
  const target = nodes.get(link.oid);
  if (!target) report.add(Category.BrokenLink, 'Object link has no valid target', { ...details, oid: link.oid, path: link.path });
  else if (link.type && target.type !== link.type) report.add(Category.TypeMismatch, 'Object link points to the wrong type', {
    ...details, oid: link.oid, expectedType: link.type, actualType: target.type, path: link.path
  });
}

function detectCycles(nodes, report, options) {
  const colors = new Map();
  for (const [oid, node] of nodes) {
    if (!node || colors.has(oid)) continue;
    const stack = [{ node, next: 0 }];
    colors.set(oid, 1);
    while (stack.length) {
      checkCancelled(options.signal);
      checkLimit(stack.length, options.maxDepth ?? 1_000_000, 'Integrity graph depth');
      const frame = stack.at(-1);
      const link = frame.node.links[frame.next++];
      if (!link) {
        colors.set(frame.node.oid, 2);
        stack.pop();
        continue;
      }
      if (link.external || !nodes.get(link.oid)) continue;
      if (colors.get(link.oid) === 1) report.add(Category.Cycle, 'Object graph contains a cycle', { oid: link.oid, source: frame.node.oid });
      else if (!colors.has(link.oid)) {
        colors.set(link.oid, 1);
        stack.push({ node: nodes.get(link.oid), next: 0 });
      }
    }
  }
}
