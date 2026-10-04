import { instructionBoundaries } from './eh-regions/boundaries.js';
import { regionFailure } from './eh-regions/contracts.js';
import { regionSettings, buildRegionTree } from './eh-regions/build.js';
export { exceptionRegionDiagnosticCatalog } from './eh-regions/contracts.js';

/** Build an owned immutable lexical EH tree. Offsets are bytes; errors carry stable CILR codes. */
export function buildExceptionRegionTree(code, handlers, options = {}) {
  if (!(code instanceof Uint8Array)) regionFailure('CILR0001');
  const limits = regionSettings(code.length, handlers, options);
  const boundary = instructionBoundaries(code, limits);
  return buildRegionTree(code.length, handlers, boundary, limits);
}
