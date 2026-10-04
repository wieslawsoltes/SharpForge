import { instructionBoundaries } from './eh-regions/boundaries.js';
import { checkRegionCancellation, regionFailure } from './eh-regions/contracts.js';
import { nestRegions, validateFamilies } from './eh-regions/tree.js';
import { projectClauses } from './eh-regions/layout.js';
export { exceptionRegionDiagnosticCatalog } from './eh-regions/contracts.js';

const defaults = Object.freeze({ maxCodeBytes: 16 * 1024 * 1024, maxInstructions: 1_000_000, maxClauses: 100_000, maxDepth: 1024 });

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
