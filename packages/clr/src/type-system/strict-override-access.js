import { loadError, LoadErrorCode } from '../load-errors.js';

const fail = message => loadError(LoadErrorCode.TypeLoad, message);
// CoreCLR TestOverRide: rows are overriding access, bits name accessible base masks.
// Only the same-assembly columns above Private apply to this bounded policy.
const widening = Object.freeze([0, 0, 0b0000100, 0b0001100, 0b0010100, 0b0111100, 0b1111100]);

function checkOwner(method, maxRows) {
  const owner = method.declaringType;
  if (owner.declaringType || (owner.flags & 7) > 1) {
    throw fail('Nested strict overrides require an enclosing-type access policy');
  }
  if (method.module.rowCount(42) + method.module.rowCount(44) > maxRows) {
    throw loadError(LoadErrorCode.LimitExceeded, 'Strict override generic metadata row limit exceeded');
  }
  if (owner.genericParameters.length || method.signature.genericArity) {
    throw fail('Generic strict overrides require a later access policy');
  }
}

/** Check one already matched ancestor edge; identities and traversal belong to the existing slot walk. */
export function checkStrictOverrideAccess(implementation, declaration, maxRows) {
  if (implementation.assembly !== declaration.assembly) {
    throw fail('Cross-assembly strict overrides require friend and external access policies');
  }
  checkOwner(implementation, maxRows);
  checkOwner(declaration, maxRows);
  const parent = declaration.flags & 7;
  const child = implementation.flags & 7;
  if (parent === 7 || child === 7) throw loadError(LoadErrorCode.InvalidImage, 'Invalid strict override access mask');
  if (parent <= 1) throw fail('Strict override cannot access a private or private-scope base method');
  if (!(widening[child] & (1 << parent))) throw fail('Strict override narrows or changes base method accessibility');
}
