import { decodeSignature } from '../../metadata/signatures.js';
import { known, unknown } from '../metadata-types/results.js';
import { metadataOperation, rejectMember } from './budget.js';

function freezeSignature(node, state, types) {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) state.nodes++;
  if (node.token) {
    const result = types.resolveType(node.token);
    if (result.status === 'unknown') state.missing ??= result;
  }
  if (node.kind === 'genericParameter' || node.kind === 'genericInstance' || node.kind === 'functionPointer') {
    state.missing ??= unknown('unsupported-member-signature');
  }
  for (const value of Object.values(node)) if (value && typeof value === 'object') freezeSignature(value, state, types);
  Object.freeze(node);
}

/** Decode each owned blob once, with both per-signature and aggregate AST node budgets. */
export function memberSignatures(types, budget) {
  const cache = new Map();
  let remaining = budget.maxMemberSignatureNodes;
  return signature => {
    budget.check();
    if (cache.has(signature)) return cache.get(signature);
    if (!remaining) rejectMember('CILVM0002', 'signature nodes');
    const ast = metadataOperation(() => decodeSignature(signature.bytes, {
      maxDepth: 32, maxNodes: 256,
    }));
    const state = { nodes: 0, missing: null };
    freezeSignature(ast, state, types);
    if (state.nodes > remaining) rejectMember('CILVM0002', 'signature nodes');
    remaining -= state.nodes;
    if (ast.kind !== 'field' && ast.kind !== 'method') rejectMember('CILVM0001', 'expected field or method signature');
    if (ast.kind === 'method' && (ast.genericArity || ast.callingConvention !== 0 || ast.explicitThis)) {
      state.missing ??= unknown('unsupported-method-convention');
    }
    const result = state.missing ?? known(ast);
    cache.set(signature, result);
    return result;
  };
}
