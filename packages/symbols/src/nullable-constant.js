import { decodeTypeSignature } from '@sharpforge/cil';
import { fail } from './contracts.js';

const scalarArguments = new Set([
  'bool',
  'char',
  'sbyte',
  'byte',
  'short',
  'ushort',
  'int',
  'uint',
  'long',
  'ulong',
  'float',
  'double',
  'nint',
  'nuint',
]);

/** Bound all referenced TypeSpec blobs before any signature AST expansion; views stay within the current load. */
export function constantTypeSpecs(constants, metadata) {
  let specs = null;
  let bytes = 0;
  for (const constant of constants) {
    const token = constant.typeToken;
    if (token >>> 24 !== 27 || specs?.has(token)) continue;
    if ((specs?.size ?? 0) >= 1024) fail('Constant TypeSpec count limit exceeded');
    const signature = metadata.blob(metadata.row(token)[0]);
    if (signature.length > 4096 || (bytes += signature.length) > 1024 * 1024) {
      fail('Constant TypeSpec byte limit exceeded');
    }
    (specs ??= new Map()).set(token, signature);
  }
  return specs;
}

/** Recognize closed scalar Nullable<T> only; no generic substitution or arbitrary value-type reconstruction. */
export function nullableTypeSpec(bytes, namedType) {
  const type = decodeTypeSignature(bytes, { maxDepth: 32, maxNodes: 256 });
  if (type.kind !== 'genericInstance' || type.type.kind !== 'valuetype' || type.arguments.length !== 1) return false;
  if (namedType(type.type.token) !== 'Nullable`1') return false;
  const argument = type.arguments[0];
  if (argument.kind === 'primitive') return scalarArguments.has(argument.name);
  if (argument.kind !== 'valuetype') return false;
  const name = namedType(argument.token);
  return name === 'Decimal' || name === 'DateTime';
}
