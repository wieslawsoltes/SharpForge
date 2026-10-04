import {CilError} from '../binary.js';
import {decodeSignature} from './signatures.js';

const tables = new Map([
  [4, {column: 2, kinds: ['field']}],
  [6, {column: 4, kinds: ['method']}],
  [10, {column: 2, kinds: ['field', 'method']}],
  [17, {column: 0, kinds: ['locals', 'method']}],
  [43, {column: 1, kinds: ['methodSpec']}]
]);

function freezeSignature(node) {
  if (!node || typeof node !== 'object' || Object.isFrozen(node)) return node;
  for (const value of Object.values(node)) freezeSignature(value);
  return Object.freeze(node);
}

/** Decode an executable member's lossless AST, retaining fnptr flags and nested type identity.
 * Token is a Field, MethodDef, MemberRef, StandAloneSig or MethodSpec. Parser options
 * preserve decodeSignature's complexity/cancellation limits. No display projection or cache.
 */
export function readExecutionSignatureAst(metadata, token, options = {}) {
  if (!Number.isInteger(token) || token <= 0 || token > 0xffffffff || !(token & 0xffffff)) {
    throw new CilError('Invalid signature metadata token');
  }
  const table = tables.get(token >>> 24);
  if (!table) throw new CilError('Token has no executable member signature');
  if (typeof metadata?.row !== 'function' || typeof metadata?.blob !== 'function') {
    throw new CilError('Signature metadata reader is required');
  }
  const row = metadata.row(token);
  const signature = decodeSignature(metadata.blob(row[table.column]), options);
  if (!table.kinds.includes(signature.kind)) throw new CilError('Signature kind does not match its metadata table');
  return freezeSignature(signature);
}

/** Select a raw slot type without stripping modifiers, pinning or function-pointer headers.
 * Parameter indexes are zero-based declared parameters, excluding implicit this. Local and
 * parameter slots require an index; field and return slots forbid one. Returns the original node.
 */
export function signatureSlotType(signature, kind, index) {
  let values;
  if (kind === 'local' && signature?.kind === 'locals') values = signature.types;
  else if (kind === 'parameter' && signature?.kind === 'method') values = signature.parameters;
  else if (kind === 'field' && signature?.kind === 'field' && index === undefined) return signature.type;
  else if (kind === 'return' && signature?.kind === 'method' && index === undefined) return signature.returnType;
  else throw new CilError('Signature does not contain the requested slot');
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new CilError('Invalid signature slot index');
  return values[index];
}
