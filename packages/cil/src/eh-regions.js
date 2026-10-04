import { exceptionClausePayload, validateExceptionClause } from './exception-clauses.js';
import { instructionBoundaries } from './eh-regions/boundaries.js';
import { checkRegionCancellation, regionFailure } from './eh-regions/contracts.js';
import { nestRegions, validateFamilies } from './eh-regions/tree.js';
export { exceptionRegionDiagnosticCatalog } from './eh-regions/contracts.js';

const defaults = Object.freeze({ maxCodeBytes: 16 * 1024 * 1024, maxInstructions: 1_000_000, maxClauses: 100_000, maxDepth: 1024 });
const handlerKinds = Object.freeze({ 0: 'catch', 1: 'filter-handler', 2: 'finally', 4: 'fault' });

function settings(code, handlers, options) {
  if (!(code instanceof Uint8Array) || !Array.isArray(handlers) || !options || typeof options !== 'object') regionFailure('CILR0001');
  const limits = { ...defaults, ...options };
  for (const name of Object.keys(defaults)) {
    if (!Number.isInteger(limits[name]) || limits[name] < 0 || limits[name] > defaults[name]) regionFailure('CILR0001');
  }
  checkRegionCancellation(limits.signal);
  if (code.length > limits.maxCodeBytes || handlers.length > limits.maxClauses) regionFailure('CILR0002');
  return limits;
}

function appendRegion(regions, kind, start, end, index) {
  const region = { id: regions.length, kind, start, end, parent: null, children: [], clauses: [index] };
  regions.push(region);
  return region.id;
}

function validateBoundaries(clause, boundary) {
  if (!boundary(clause.start)) regionFailure('CILR0016');
  if (!boundary(clause.end)) regionFailure('CILR0017');
  if (!boundary(clause.target)) regionFailure('CILR0018');
  if (!boundary(clause.handlerEnd)) regionFailure('CILR0019');
  const filter = clause.flags === 1 ? exceptionClausePayload(clause) : null;
  if (filter !== null && !boundary(filter)) regionFailure('CILR0020');
  const handlerStart = filter ?? clause.target;
  if (clause.start < clause.handlerEnd && handlerStart < clause.end) regionFailure('CILR0021');
}

function projectClauses(handlers, boundary, options) {
  const regions = [];
  const clauses = [];
  const tries = new Map();
  for (const [index, clause] of handlers.entries()) {
    checkRegionCancellation(options.signal);
    validateExceptionClause(clause, options.codeSize, regionFailure);
    validateBoundaries(clause, boundary);
    const flags = clause.flags ?? 0;
    const key = `${clause.start}:${clause.end}`;
    let shared = tries.get(key);
    if (shared) {
      if (flags === 2 || flags === 4 || shared.exclusive) regionFailure('CILR0024');
      regions[shared.id].clauses.push(index);
    } else {
      shared = { id: appendRegion(regions, 'try', clause.start, clause.end, index), exclusive: flags === 2 || flags === 4 };
      tries.set(key, shared);
    }
    const handlerRegion = appendRegion(regions, handlerKinds[flags], clause.target, clause.handlerEnd, index);
    const filterRegion = flags === 1 ? appendRegion(regions, 'filter', exceptionClausePayload(clause), clause.target, index) : null;
    clauses.push({ index, flags, tryRegion: shared.id, handlerRegion, filterRegion });
  }
  return { regions, clauses };
}

/** Build an owned immutable lexical EH tree. Offsets are bytes; errors carry stable CILR codes. */
export function buildExceptionRegionTree(code, handlers, options = {}) {
  const limits = settings(code, handlers, options);
  const boundary = instructionBoundaries(code, limits);
  const { regions, clauses } = projectClauses(handlers, boundary, { ...limits, codeSize: code.length });
  const roots = nestRegions(regions, limits);
  validateFamilies(clauses, regions, limits.signal);
  for (const region of regions) {
    Object.freeze(region.children);
    Object.freeze(region.clauses);
    Object.freeze(region);
  }
  for (const clause of clauses) Object.freeze(clause);
  return Object.freeze({ codeSize: code.length, roots: Object.freeze(roots), regions: Object.freeze(regions), clauses: Object.freeze(clauses) });
}
