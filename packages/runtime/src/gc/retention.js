import {isReference} from './reference.js';

const exhausted = Object.freeze({budget: true});

export function diagnosticBudget(options = {}) {
  const value = {maxObjects: options.maxObjects ?? 20_000, maxEdges: options.maxEdges ?? 200_000};
  if (!Number.isInteger(value.maxObjects) || value.maxObjects < 1 || value.maxObjects > 1_000_000) {
    throw new RangeError('Invalid retention object budget');
  }
  if (!Number.isInteger(value.maxEdges) || value.maxEdges < 1 || value.maxEdges > 10_000_000) {
    throw new RangeError('Invalid retention edge budget');
  }
  return value;
}

function rootLabel(category, detail) {
  const names = {vm: 'VM root', temporary: 'Temporary root', pin: 'Pinned root', handle: 'Strong host handle', finalizer: 'Finalizer queue'};
  const prefix = names[category] ?? String(category ?? 'VM root');
  if (detail === null || detail === undefined) return prefix;
  if (typeof detail === 'string' || typeof detail === 'number') return `${prefix} ${detail}`;
  return `${prefix} ${detail.name ?? detail.id ?? detail.index ?? ''}`.trim();
}

/** Build a rooted graph in O(V + E), with a synthetic root at index zero. */
export function retentionGraph(heap, options = {}) {
  const limits = diagnosticBudget(options);
  const nodes = [{reference: null, type: '<roots>', size: 0, edges: [], incoming: []}];
  const indexes = new Map();
  let scanned = 0;
  let truncated = false;
  let reason = null;
  let conditionalOwnership = false;
  const dependentEdges = new Map();
  const stop = name => {
    truncated = true;
    reason ??= name;
    throw exhausted;
  };
  const add = (value, from, label, condition = null) => {
    if (++scanned > limits.maxEdges) stop('maxEdges');
    if (!isReference(value)) return;
    const record = heap.tryGet(value);
    if (!record) return;
    let index = indexes.get(value.h);
    if (index === undefined) {
      if (indexes.size === limits.maxObjects) stop('maxObjects');
      index = nodes.length;
      indexes.set(value.h, index);
      nodes.push({reference: value, type: record.type, kind: record.kind, size: record.size, edges: [], incoming: []});
    }
    const edge = {from, to: index, label, condition};
    nodes[from].edges.push(edge);
    nodes[index].incoming.push(edge);
  };
  try {
    heap.lifetime?.visitDiagnosticEdges?.((key, value, label, owner = null) => {
      if (++scanned > limits.maxEdges) stop('maxEdges');
      if (!heap.tryGet(key) || owner && !heap.tryGet(owner)) return;
      const edge = {key, value, label, owner, activated: false};
      for (const reference of owner && owner.h !== key.h ? [key, owner] : [key]) {
        let edges = dependentEdges.get(reference.h);
        if (!edges) dependentEdges.set(reference.h, edges = []);
        edges.push(edge);
      }
    });
    heap.visitRoots((value, category, detail) => add(value, 0, rootLabel(category, detail)), options.extraRoots ?? []);
    for (let index = 1; index < nodes.length; index++) {
      const node = nodes[index];
      const record = heap.get(node.reference);
      heap.visitEdges(record, (value, slot) => add(value, index, `${record.kind === 'array' ? 'Element' : 'Field'} ${slot}`));
      for (const edge of dependentEdges.get(node.reference.h) ?? []) {
        if (edge.activated || !indexes.has(edge.key.h) || edge.owner && !indexes.has(edge.owner.h)) continue;
        edge.activated = true;
        conditionalOwnership ||= edge.owner !== null && edge.owner.h !== edge.key.h;
        add(edge.value, indexes.get(edge.key.h), edge.label, edge.owner);
      }
    }
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  return {nodes, indexes, truncated, reason, conditionalOwnership,
    visited: indexes.size, edgesScanned: Math.min(scanned, limits.maxEdges)};
}

function pathStep(graph, edge) {
  const node = graph.nodes[edge.to];
  return {reference: node.reference, label: edge.label, type: node.type,
    ...(edge.condition ? {requiresOwner: edge.condition} : {})};
}

/** Shortest strong path, breadth first. Unreachable and budget exhausted are distinct. */
export function retentionPath(heap, reference, options = {}) {
  heap.get(reference);
  const graph = retentionGraph(heap, options);
  const target = graph.indexes.get(reference.h);
  const path = [];
  if (target !== undefined) {
    // Dependent edges may activate after their owner is discovered on a longer branch.
    // A fresh BFS over the completed bounded graph preserves shortest-path semantics.
    const previous = new Array(graph.nodes.length);
    const work = [0];
    previous[0] = null;
    for (let index = 0; index < work.length && previous[target] === undefined; index++) {
      for (const edge of graph.nodes[work[index]].edges) {
        if (previous[edge.to] !== undefined) continue;
        previous[edge.to] = edge;
        work.push(edge.to);
      }
    }
    let index = target;
    while (index !== 0) {
      const edge = previous[index];
      path.push(pathStep(graph, edge));
      index = edge.from;
    }
    path.reverse();
  }
  return {reachable: path.length > 0, path, truncated: graph.truncated, reason: graph.reason,
    visited: graph.visited, edgesScanned: graph.edgesScanned, stamp: heap.stamp()};
}

/** Enumerate simple root paths; cycles, exponential path counts and depth are bounded. */
export function retentionPaths(heap, reference, options = {}) {
  heap.get(reference);
  const maxPaths = options.maxPaths ?? 64;
  const maxDepth = options.maxDepth ?? 256;
  const maxSteps = options.maxSteps ?? 200_000;
  for (const [name, value, limit] of [['maxPaths', maxPaths, 10_000], ['maxDepth', maxDepth, 100_000], ['maxSteps', maxSteps, 10_000_000]]) {
    if (!Number.isInteger(value) || value < 1 || value > limit) throw new RangeError(`Invalid ${name} path budget`);
  }
  const graph = retentionGraph(heap, options);
  const target = graph.indexes.get(reference.h);
  const paths = [];
  if (target === undefined) return {...retentionResult(graph, paths, 0), stamp: heap.stamp()};
  const frames = [{index: target, next: 0}];
  const active = new Set([target]);
  const selected = [];
  let steps = 0;
  while (frames.length) {
    if (++steps > maxSteps) {
      graph.truncated = true;
      graph.reason ??= 'maxSteps';
      break;
    }
    const frame = frames.at(-1);
    const incoming = graph.nodes[frame.index].incoming;
    if (frame.next === incoming.length) {
      active.delete(frame.index);
      frames.pop();
      if (selected.length) selected.pop();
      continue;
    }
    const edge = incoming[frame.next++];
    if (edge.from === 0) {
      if (paths.length === maxPaths) {
        graph.truncated = true;
        graph.reason ??= 'maxPaths';
        break;
      }
      paths.push([edge, ...selected.toReversed()].map(item => pathStep(graph, item)));
    } else if (!active.has(edge.from)) {
      if (frames.length === maxDepth) {
        graph.truncated = true;
        graph.reason ??= 'maxDepth';
        continue;
      }
      selected.push(edge);
      active.add(edge.from);
      frames.push({index: edge.from, next: 0});
    }
  }
  return {...retentionResult(graph, paths, Math.min(steps, maxSteps)), stamp: heap.stamp()};
}

function retentionResult(graph, paths, searchSteps) {
  return {reachable: paths.length > 0, paths, truncated: graph.truncated, reason: graph.reason,
    visited: graph.visited, edgesScanned: graph.edgesScanned, searchSteps};
}
