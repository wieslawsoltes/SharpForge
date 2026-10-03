import {retentionGraph} from './retention.js';

function depthFirst(graph) {
  const numbers = new Int32Array(graph.nodes.length);
  const parent = new Int32Array(graph.nodes.length);
  const vertices = [0, 0];
  numbers[0] = 1;
  const stack = [{node: 0, next: 0}];
  while (stack.length) {
    const frame = stack.at(-1);
    const edges = graph.nodes[frame.node].edges;
    if (frame.next === edges.length) {
      stack.pop();
      continue;
    }
    const target = edges[frame.next++].to;
    if (numbers[target]) continue;
    numbers[target] = vertices.length;
    vertices.push(target);
    parent[target] = frame.node;
    stack.push({node: target, next: 0});
  }
  return {numbers, parent, vertices};
}

/** Lengauer-Tarjan dominators. O((V + E) log V), O(V + E) memory, no recursive stack. */
export function computeDominators(heap, options = {}) {
  const maxSteps = options.maxSteps ?? 4_000_000;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100_000_000) throw new RangeError('Invalid dominator budget');
  const graph = retentionGraph(heap, options);
  const {numbers, parent, vertices} = depthFirst(graph);
  const count = graph.nodes.length;
  const semi = numbers.slice();
  const ancestor = new Int32Array(count).fill(-1);
  const label = Int32Array.from({length: count}, (_, index) => index);
  const idom = new Int32Array(count).fill(-1);
  const buckets = Array.from({length: count}, () => []);
  const compression = [];
  let steps = 0;
  const exhausted = Object.freeze({});
  const tick = () => {
    if (++steps > maxSteps) throw exhausted;
  };
  const evaluate = node => {
    if (ancestor[node] < 0) return label[node];
    compression.length = 0;
    let current = node;
    while (ancestor[current] >= 0 && ancestor[ancestor[current]] >= 0) {
      tick();
      compression.push(current);
      current = ancestor[current];
    }
    while (compression.length) {
      current = compression.pop();
      const next = ancestor[current];
      if (semi[label[next]] < semi[label[current]]) label[current] = label[next];
      ancestor[current] = ancestor[next];
    }
    return label[node];
  };
  try {
    for (let order = vertices.length - 1; order > 1; order--) {
      const node = vertices[order];
      for (const edge of graph.nodes[node].incoming) {
        tick();
        semi[node] = Math.min(semi[node], semi[evaluate(edge.from)]);
      }
      buckets[vertices[semi[node]]].push(node);
      ancestor[node] = parent[node];
      const pending = buckets[parent[node]];
      for (const candidate of pending) {
        tick();
        const best = evaluate(candidate);
        idom[candidate] = semi[best] < semi[candidate] ? best : parent[node];
      }
      pending.length = 0;
    }
    for (let order = 2; order < vertices.length; order++) {
      tick();
      const node = vertices[order];
      if (idom[node] !== vertices[semi[node]]) idom[node] = idom[idom[node]];
    }
  } catch (error) {
    if (error !== exhausted) throw error;
    graph.truncated = true;
    graph.reason = 'maxSteps';
  }
  const exact = !graph.truncated && !graph.conditionalOwnership;
  const retained = Float64Array.from(graph.nodes, node => node.size);
  if (exact) {
    for (let order = vertices.length - 1; order > 1; order--) {
      const node = vertices[order];
      retained[idom[node]] += retained[node];
    }
  }
  const nodes = graph.nodes.slice(1).map((node, offset) => ({reference: node.reference, type: node.type,
    shallowSize: node.size, retainedSize: exact ? retained[offset + 1] : null,
    immediateDominator: exact && idom[offset + 1] > 0 ? graph.nodes[idom[offset + 1]].reference : null}));
  return {nodes, retainedBytes: exact ? retained[0] : null, exact, truncated: graph.truncated,
    reason: graph.reason ?? (graph.conditionalOwnership ? 'conditionalOwnership' : null),
    visited: graph.visited, edgesScanned: graph.edgesScanned, steps: Math.min(steps, maxSteps), stamp: heap.stamp()};
}
