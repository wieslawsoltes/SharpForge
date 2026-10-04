import { CilError } from '../binary.js';
import { decodeInstructionGroups } from '../il-prefixes.js';

export const typePrefixDiagnosticCatalog = Object.freeze({
  CILPC0001: 'Duplicate constrained or readonly prefix on one instruction',
  CILPC0002: 'Constrained prefix requires callvirt in the ECMA-335 profile',
  CILPC0003: 'Readonly prefix requires an array address operation',
  CILPC0004: 'Prefix type token does not identify an existing TypeDef, TypeRef or TypeSpec row',
  CILPC0005: 'Type-prefix validation requires a metadata row reader',
  CILPC0006: 'Readonly array Address calls require a method-resolution service',
});

function reject(code, prefix, group, token) {
  const error = new CilError(typePrefixDiagnosticCatalog[code], prefix?.offset);
  error.code = code;
  error.prefix = prefix?.name;
  error.target = group?.name;
  error.targetOffset = group?.opcodeOffset;
  error.token = token;
  throw error;
}

function requireTypeToken(token, metadata, prefix, group) {
  const table = token >>> 24;
  if (!Number.isInteger(token) || token < 0 || token > 0xffffffff ||
      (table !== 1 && table !== 2 && table !== 27) || !(token & 0xffffff)) {
    reject('CILPC0004', prefix, group, token);
  }
  let row;
  try {
    row = metadata.row(token);
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    reject('CILPC0004', prefix, group, token);
  }
  if (!row) reject('CILPC0004', prefix, group, token);
}

function constrained(prefix, group, metadata) {
  if (group.name !== 'callvirt') reject('CILPC0002', prefix, group);
  requireTypeToken(prefix.operand, metadata, prefix, group);
}

function readonly(prefix, group, metadata) {
  if (group.name === 'call' || group.name === 'callvirt') reject('CILPC0006', prefix, group);
  if (group.name !== 'ldelema') reject('CILPC0003', prefix, group);
  requireTypeToken(group.operand, metadata, prefix, group);
}

const checks = Object.freeze({
  'constrained.': Object.freeze({ bit: 1, validate: constrained }),
  'readonly.': Object.freeze({ bit: 2, validate: readonly }),
});

/**
 * Validate lexical type prefixes and token row extents using readPE(...).metadata.
 * Returns caller-owned groups; throws offset-bearing CilError diagnostics.
 * Does not resolve methods/types or verify pointer/stack/escape compatibility.
 */
export function validateTypePrefixes(code, metadata, options = {}) {
  if (!metadata || typeof metadata.row !== 'function') reject('CILPC0005');
  const groups = decodeInstructionGroups(code, options);
  for (const group of groups) {
    if (options.signal?.aborted) throw new CilError('CIL type prefix validation cancelled', group.offset);
    let seen = 0;
    for (const prefix of group.prefixes) {
      if (!Object.hasOwn(checks, prefix.name)) continue;
      const check = checks[prefix.name];
      if (seen & check.bit) reject('CILPC0001', prefix, group);
      seen |= check.bit;
      check.validate(prefix, group, metadata);
    }
  }
  return groups;
}
