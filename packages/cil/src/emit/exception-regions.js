import { Op } from '@sharpforge/bytecode';
import { CilError } from '../binary.js';
import { projectClauses } from '../eh-regions/layout.js';
import { nestRegions, validateFamilies } from '../eh-regions/tree.js';
import { ExceptionTransferIndex, containsExceptionRegion } from '../eh-regions/transfer-index.js';

const emptyLayout = Object.freeze({ handlers: Object.freeze([]),
  handlerAt: () => undefined, filterAt: () => undefined, filterDecisionAt: () => undefined,
  protected: () => false, leaves: () => false });

function invalid(message) {
  const error = new CilError(message);
  error.code = 'CILEM0001';
  throw error;
}

function sourceHandlers(method, count) {
  const families = new Map();
  for (const handler of method.handlers) {
    if (!handler || (handler.kind !== undefined && handler.kind !== 'catch' && handler.kind !== 'finally' && handler.kind !== 'filter'))
      invalid('Unsupported source exception handler kind');
    if (!Number.isInteger(handler.start) || !Number.isInteger(handler.end) || handler.start < 0 ||
        handler.end < handler.start || handler.end >= count) invalid('Invalid source protected region');
    if (handler.kind === 'finally') continue;
    const key = `${handler.start}:${handler.end}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(handler);
  }
  const ends = new Map();
  for (const family of families.values()) {
    const ordered = [...family].sort((left, right) => left.target - right.target);
    const last = ordered.at(-1);
    const after = method.code[last.end * 3] === Op.JUMP ? method.code[last.end * 3 + 1] : null;
    for (let index = 0; index < ordered.length; index++) {
      const handler = ordered[index];
      const end = handler.handlerEnd ?? ordered[index + 1]?.filter ?? ordered[index + 1]?.target ?? after;
      if (end === null) invalid('Catch handler end requires an explicit boundary or source exit jump');
      ends.set(handler, end);
    }
  }
  return method.handlers.map(handler => ({ ...handler,
    tryEndPc: handler.end + 1,
    handlerEndPc: handler.kind === 'finally' ? handler.handlerEnd : ends.get(handler) }));
}

function clauseOrder(tree) {
  const depths = new Uint32Array(tree.regions.length);
  const pending = [...tree.roots];
  while (pending.length) {
    const region = tree.regions[pending.pop()];
    for (const child of region.children) {
      depths[child] = depths[region.id] + 1;
      pending.push(child);
    }
  }
  const ordered = [...tree.clauses].sort((left, right) =>
    depths[right.tryRegion] - depths[left.tryRegion] || left.index - right.index);
  const remap = new Uint32Array(ordered.length);
  ordered.forEach((clause, index) => { remap[clause.index] = index; });
  for (const region of tree.regions) region.clauses = region.clauses.map(index => remap[index]).sort((a, b) => a - b);
  tree.clauses = ordered.map((clause, index) => ({ ...clause, index }));
  validateFamilies(tree.clauses, tree.regions);
  return ordered.map(clause => clause.index);
}

/** Source-PC geometry, with catch/finally clauses ordered inside-out and indexed membership queries. */
export function sourceExceptionLayout(method) {
  const count = method.code.length / 3;
  if (!Array.isArray(method.handlers) || !Number.isInteger(count) || count > 1_000_000 || method.handlers.length > 100_000)
    invalid('Source exception layout size limit exceeded');
  if (!method.handlers.length) return emptyLayout;
  const handlers = sourceHandlers(method, count);
  // Geometry validation needs a non-nil catch-token shape; emission resolves the real catch type later.
  const raw = handlers.map(handler => ({ start: handler.start, end: handler.tryEndPc, target: handler.target,
    handlerEnd: handler.handlerEndPc, flags: handler.kind === 'finally' ? 2 : handler.filter !== undefined ? 1 : 0,
    catchType: handler.kind === 'finally' ? 0 : handler.filter ?? 0x01000001 }));
  const { regions, clauses } = projectClauses(raw, pc => Number.isInteger(pc) && pc >= 0 && pc <= count, { codeSize: count });
  const tree = { regions, clauses, roots: nestRegions(regions, { maxDepth: 1024 }) };
  const order = clauseOrder(tree);
  const entries = new Map(), filters = new Map(), decisions = new Map();
  for (const handler of handlers) {
    if (entries.has(handler.target)) invalid('Source exception handlers share an entry');
    entries.set(handler.target, handler);
    if (handler.filter !== undefined) {
      if (filters.has(handler.filter)) invalid('Source filters share an entry');
      if (method.code[(handler.target - 1) * 3] !== Op.ENDFILTER) invalid('Source filter requires a terminal endfilter');
      filters.set(handler.filter, handler);
      decisions.set(handler.target - 1, handler);
    }
  }
  const membership = new ExceptionTransferIndex(tree);
  return {
    handlers: order.map(index => handlers[index]),
    handlerAt: pc => entries.get(pc),
    filterAt: pc => filters.get(pc),
    filterDecisionAt: pc => decisions.get(pc),
    protected: pc => membership.regionAt(pc) !== null,
    leaves: (source, target) => !containsExceptionRegion(membership.regionAt(source), target),
  };
}
