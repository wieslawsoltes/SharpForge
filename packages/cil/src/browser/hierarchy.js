import { AssemblySymbolIndex } from './index.js';
import { hierarchyBudget, preflightHierarchy, invalidHierarchy, hierarchyLimit } from './hierarchy-budget.js';
import { bindHierarchy } from './hierarchy-binding.js';

function checkCycles(nodes, budget) {
  const colors = new Map();
  for (const node of nodes.values()) {
    if (colors.get(node.id) === 2) continue;
    const stack = [{ node, position: 0 }];
    colors.set(node.id, 1);
    while (stack.length) {
      budget.check();
      const frame = stack[stack.length - 1];
      if (frame.position > frame.node.interfaces.length) {
        colors.set(frame.node.id, 2);
        stack.pop();
        continue;
      }
      const edge = frame.position++ === 0 ? frame.node.base : frame.node.interfaces[frame.position - 2];
      if (typeof edge !== 'string' || colors.get(edge) === 2) continue;
      if (colors.get(edge) === 1) invalidHierarchy('cyclic inheritance');
      colors.set(edge, 1);
      stack.push({ node: nodes.get(edge), position: 0 });
    }
  }
}

function addReverse(map, target, source) {
  if (typeof target !== 'string') return;
  let entries = map.get(target);
  if (!entries) map.set(target, entries = []);
  entries.push(source);
}

function* neighbors(node, direction, bases, interfaces, nodes) {
  if (direction === 'base') {
    if (node.base) yield [node.base, 'base'];
    for (const edge of node.interfaces) yield [edge, 'interface'];
    return;
  }
  for (const id of bases.get(node.id) ?? []) yield [id, 'derived'];
  if (node.isInterface) {
    for (const id of interfaces.get(node.id) ?? []) {
      if (direction === 'implementers' || nodes.get(id).isInterface) yield [id, 'implementer'];
    }
  }
}

/** Owned base/derived/implementer trees over explicitly loaded modules, using the existing symbol index's IDs. */
export class AssemblyTypeHierarchy {
  #index;
  #nodes;
  #bases = new Map();
  #interfaces = new Map();
  #storage;
  #limits;

  constructor(index, assemblies, options = {}) {
    if (!(index instanceof AssemblySymbolIndex)) invalidHierarchy('AssemblySymbolIndex required');
    const budget = hierarchyBudget(options);
    this.#storage = preflightHierarchy(assemblies, budget);
    this.#nodes = bindHierarchy(index, assemblies, budget);
    checkCycles(this.#nodes, budget);
    for (const node of this.#nodes.values()) {
      budget.check();
      addReverse(this.#bases, node.base, node.id);
      for (const target of node.interfaces) addReverse(this.#interfaces, target, node.id);
    }
    this.#index = index;
    this.#limits = { maxQueryNodes: budget.maxQueryNodes, maxDepth: budget.maxDepth };
  }

  /** Counts/preflight payload charges, not JavaScript heap or retained-byte measurements. */
  get storage() { return { ...this.#storage }; }

  /** Fresh tree; repeated DAG nodes are marked and not expanded twice. Unknown index IDs return null. */
  tree(id, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) invalidHierarchy('query options');
    const { direction = 'base', maxQueryNodes = this.#limits.maxQueryNodes, maxDepth = this.#limits.maxDepth, signal } = options;
    if (!['base', 'derived', 'implementers'].includes(direction)) invalidHierarchy('direction');
    const budget = hierarchyBudget({ maxQueryNodes, maxDepth, signal });
    if (maxQueryNodes > this.#limits.maxQueryNodes || maxDepth > this.#limits.maxDepth) invalidHierarchy('query budget escalation');
    const symbol = this.#index.get(id), start = this.#nodes.get(id);
    if (!symbol || !start) return null;
    if (direction === 'implementers' && !start.isInterface) invalidHierarchy('implementer root is not an interface');
    const seen = new Set();
    let count = 0;
    const create = (edge, relation, depth) => {
      budget.check();
      if (++count > budget.maxQueryNodes || depth > budget.maxDepth) hierarchyLimit('query nodes/depth');
      const known = typeof edge === 'string', repeated = known && seen.has(edge);
      if (known) seen.add(edge);
      return { symbol: known ? this.#index.get(edge) : null, relation, diagnostic: known ? null : { ...edge }, repeated, children: [] };
    };
    const root = create(id, 'root', 0);
    const stack = [{ result: root, iterator: neighbors(start, direction, this.#bases, this.#interfaces, this.#nodes), depth: 0 }];
    while (stack.length) {
      budget.check();
      const frame = stack[stack.length - 1], next = frame.iterator.next();
      if (next.done) { stack.pop(); continue; }
      const [edge, relation] = next.value, child = create(edge, relation, frame.depth + 1);
      frame.result.children.push(child);
      if (typeof edge === 'string' && !child.repeated) stack.push({ result: child, depth: frame.depth + 1,
        iterator: neighbors(this.#nodes.get(edge), direction, this.#bases, this.#interfaces, this.#nodes) });
    }
    return root;
  }
}
