import { decodedInstructionBoundaries } from './boundaries.js';
import { checkRegionCancellation, regionFailure } from './contracts.js';
import { nestRegions, validateFamilies } from './tree.js';
import { projectClauses } from './layout.js';

const defaults = Object.freeze({ maxCodeBytes: 16 * 1024 * 1024, maxInstructions: 1_000_000, maxClauses: 100_000, maxDepth: 1024 });

export function regionSettings(codeSize, handlers, options) {
  if (!Number.isInteger(codeSize) || codeSize < 0 || !Array.isArray(handlers) || !options || typeof options !== 'object') regionFailure('CILR0001');
  const limits = { ...defaults, ...options };
  for (const name of Object.keys(defaults)) {
    if (!Number.isInteger(limits[name]) || limits[name] < 0 || limits[name] > defaults[name]) regionFailure('CILR0001');
  }
  checkRegionCancellation(limits.signal);
  if (codeSize > limits.maxCodeBytes || handlers.length > limits.maxClauses) regionFailure('CILR0002');
  return limits;
}

/** Freeze a tree after the caller has bounded its code size and established instruction boundaries. */
export function buildRegionTree(codeSize, handlers, boundary, limits) {
  const { regions, clauses } = projectClauses(handlers, boundary, { ...limits, codeSize });
  const roots = nestRegions(regions, limits);
  validateFamilies(clauses, regions, limits.signal);
  for (const region of regions) {
    Object.freeze(region.children);
    Object.freeze(region.clauses);
    Object.freeze(region);
  }
  for (const clause of clauses) Object.freeze(clause);
  return Object.freeze({ codeSize, roots: Object.freeze(roots), regions: Object.freeze(regions), clauses: Object.freeze(clauses) });
}

/** Internal inspector seam: reuse bounded decoded instructions, never a caller-selected public bypass. */
export function decodedExceptionRegions(codeSize, instructions, handlers, options = {}) {
  const limits = regionSettings(codeSize, handlers, options);
  if (instructions.length > limits.maxInstructions) regionFailure('CILR0029', 'Instruction limit exceeded');
  const boundaries = decodedInstructionBoundaries(codeSize, instructions, limits.signal);
  return { tree: buildRegionTree(codeSize, handlers, boundaries, limits), boundaries, limits };
}
