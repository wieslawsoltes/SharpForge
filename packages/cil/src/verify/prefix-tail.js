import { CilError } from '../binary.js';
import { decodeInstructionGroups } from '../il-prefixes.js';
import { buildExceptionRegionTree } from '../eh-regions.js';
import { ExceptionRegionCursor } from '../eh-regions/cursor.js';
import { checkRegionCancellation } from '../eh-regions/contracts.js';
import { validateTailPlacement } from '../eh-control-flow.js';

export const tailPrefixDiagnosticCatalog = Object.freeze({
  CILPT0001: 'Duplicate tail prefix on one instruction',
  CILPT0002: 'Tail prefix requires call, callvirt or calli',
  CILPT0003: 'Tail call must be followed immediately by an unprefixed ret',
});

function reject(code, prefix, group) {
  const error = new CilError(tailPrefixDiagnosticCatalog[code], prefix.offset);
  error.code = code;
  error.target = group.name;
  error.targetOffset = group.opcodeOffset;
  throw error;
}

/**
 * Check tail-prefix lexical form and EH exclusion, returning owned decoded groups.
 * Stack arguments, managed-pointer lifetimes and return types require a separate typed verifier.
 * Errors retain CILR/group-decoder codes, CILCF0006 for EH placement, or CILPT codes with prefix offsets.
 */
export function validateTailPrefixes(code, handlers = [], options = {}) {
  const tree = buildExceptionRegionTree(code, handlers, options);
  const groups = decodeInstructionGroups(code, options);
  const cursor = new ExceptionRegionCursor(tree);
  for (let index = 0; index < groups.length; index++) {
    checkRegionCancellation(options.signal);
    const group = groups[index];
    // Advance for every group so a later tail cannot skip an entire intervening region.
    cursor.advance(group.offset);
    let seen = false;
    for (const prefix of group.prefixes) {
      if (prefix.name !== 'tail.') continue;
      if (seen) reject('CILPT0001', prefix, group);
      seen = true;
      validateTailPlacement(prefix, cursor);
      if (group.name !== 'call' && group.name !== 'callvirt' && group.name !== 'calli') {
        reject('CILPT0002', prefix, group);
      }
      const next = groups[index + 1];
      if (next?.name !== 'ret' || next.prefixes.length) reject('CILPT0003', prefix, group);
    }
  }
  checkRegionCancellation(options.signal);
  return groups;
}
