import { loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
// CoreCLR TestOverRide: rows are overriding access, bits name accessible base masks.
// Private requires the enclosing/inheritance proof below before consulting this table.
const widening = Object.freeze([0, 0b0000010, 0b0000110, 0b0001110, 0b0010110, 0b0111110, 0b1111110]);

function checkOwner(method, maxRows, maxDepth) {
  const owner = method.declaringType;
  if (method.module.rowCount(42) + method.module.rowCount(44) > maxRows) {
    throw loadError(LoadErrorCode.LimitExceeded, 'Strict override generic metadata row limit exceeded');
  }
  // Ordinary owners retain their original checks without walking an enclosing chain.
  if (!owner.declaringType && (owner.flags & 7) <= 1) {
    if (owner.genericParameters.length || method.signature.genericArity) {
      throw fail('Generic strict overrides require a later access policy');
    }
    return;
  }
  if (method.signature.genericArity) throw fail('Generic strict overrides require a later access policy');
  let depth = 0;
  for (let enclosing = owner; enclosing; enclosing = enclosing.declaringType) {
    if (++depth > maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Strict override enclosing depth exceeded');
    if (Boolean(enclosing.declaringType) !== ((enclosing.flags & 7) > 1)) {
      throw loadError(LoadErrorCode.InvalidImage, 'Strict override owner nesting and visibility disagree');
    }
    if (enclosing.genericParameters.length) throw fail('Generic strict overrides require a later access policy');
  }
}

// CoreCLR IsBaseTypeAlsoEnclosingType requires EVERY inheritance edge to be enclosed.
// Canonical descriptors already own validated acyclic graphs; scalar limits bound this walk too.
function privateBaseAccessible(base, child, maxRows, maxDepth) {
  let inheritanceDepth = 0;
  let work = 0;
  while (child !== base) {
    if (++inheritanceDepth > maxDepth) throw loadError(LoadErrorCode.LimitExceeded, 'Strict override inheritance depth exceeded');
    const parent = child.baseType;
    if (!parent || parent.module !== child.module) return false;
    let enclosing = child.declaringType;
    let depth = 0;
    while (enclosing) {
      if (++work > maxRows || ++depth > maxDepth) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Strict override enclosing traversal exceeded');
      }
      if (enclosing === parent) break;
      enclosing = enclosing.declaringType;
    }
    if (!enclosing) return false;
    child = parent;
  }
  return true;
}

/** Check one already matched ancestor edge; identities and traversal belong to the existing slot walk. */
export function checkStrictOverrideAccess(implementation, declaration, maxRows, maxDepth) {
  if (implementation.assembly !== declaration.assembly) {
    throw fail('Cross-assembly strict overrides require friend and external access policies');
  }
  checkOwner(implementation, maxRows, maxDepth);
  checkOwner(declaration, maxRows, maxDepth);
  const parent = declaration.flags & 7;
  const child = implementation.flags & 7;
  if (parent === 7 || child === 7) throw loadError(LoadErrorCode.InvalidImage, 'Invalid strict override access mask');
  if (parent === 0 || (parent === 1 && !privateBaseAccessible(
    declaration.declaringType, implementation.declaringType, maxRows, maxDepth))) {
    throw fail('Strict override cannot access a private or private-scope base method');
  }
  if (!(widening[child] & (1 << parent))) throw fail('Strict override narrows or changes base method accessibility');
}
