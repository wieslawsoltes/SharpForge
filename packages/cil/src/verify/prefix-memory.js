import { CilError } from '../binary.js';
import { decodeInstructionGroups } from '../il-prefixes.js';

export const memoryPrefixDiagnosticCatalog = Object.freeze({
  CILPM0001: 'Duplicate memory prefix on one instruction',
  CILPM0002: 'Memory prefix is not permitted on this target instruction',
  CILPM0003: 'The no. flags request a check that the target instruction does not support',
  CILPM0004: 'The no. prefix is not verifiable',
});

const memoryTargets = new Set([
  'ldind.i1', 'ldind.u1', 'ldind.i2', 'ldind.u2', 'ldind.i4', 'ldind.u4',
  'ldind.i8', 'ldind.i', 'ldind.r4', 'ldind.r8', 'ldind.ref',
  'stind.i1', 'stind.i2', 'stind.i4', 'stind.i8', 'stind.i', 'stind.r4', 'stind.r8', 'stind.ref',
  'ldfld', 'stfld', 'ldobj', 'stobj', 'initblk', 'cpblk',
]);
const arrayTargets = new Set([
  'ldelem', 'ldelem.i1', 'ldelem.u1', 'ldelem.i2', 'ldelem.u2', 'ldelem.i4', 'ldelem.u4',
  'ldelem.i8', 'ldelem.i', 'ldelem.r4', 'ldelem.r8', 'ldelem.ref',
  'stelem', 'stelem.i', 'stelem.i1', 'stelem.i2', 'stelem.i4', 'stelem.i8', 'stelem.r4', 'stelem.r8', 'stelem.ref',
]);

function reject(code, prefix, group) {
  const error = new CilError(memoryPrefixDiagnosticCatalog[code], prefix.offset);
  error.code = code;
  error.prefix = prefix.name;
  error.target = group.name;
  error.targetOffset = group.opcodeOffset;
  throw error;
}

function noChecks(target) {
  if (target === 'ldelema' || target === 'stelem' || target === 'stelem.ref') return 7;
  if (arrayTargets.has(target)) return 6;
  if (target === 'castclass' || target === 'unbox') return 1;
  if (target === 'ldfld' || target === 'stfld' || target === 'callvirt' || target === 'ldvirtftn') return 4;
  return 0;
}

function unaligned(prefix, group) {
  if (!memoryTargets.has(group.name)) reject('CILPM0002', prefix, group);
}

function volatile(prefix, group) {
  if (!memoryTargets.has(group.name) && group.name !== 'ldsfld' && group.name !== 'stsfld') {
    reject('CILPM0002', prefix, group);
  }
}

function no(prefix, group, allowUnverifiable) {
  const checks = noChecks(group.name);
  if (!checks) reject('CILPM0002', prefix, group);
  if (prefix.operand & ~checks) reject('CILPM0003', prefix, group);
  if (!allowUnverifiable) reject('CILPM0004', prefix, group);
}

// Separate semantic checks from the binary group decoder, which preserves repeated prefixes.
const checks = Object.freeze({
  'unaligned.': Object.freeze({ bit: 1, validate: unaligned }),
  'volatile.': Object.freeze({ bit: 2, validate: volatile }),
  'no.': Object.freeze({ bit: 4, validate: no }),
});

/**
 * Validate memory-prefix targets and duplicates, returning caller-owned decoded groups.
 * Throws CilError with byte offsets; no. needs explicit allowUnverifiable for correctness-only checks.
 * This checks neither stack types nor the legality of tail., constrained. or readonly.
 */
export function validateMemoryPrefixes(bytes, options = {}) {
  const { allowUnverifiable = false, signal } = options;
  if (typeof allowUnverifiable !== 'boolean') throw new CilError('Invalid memory prefix verification option');
  const groups = decodeInstructionGroups(bytes, options);
  for (const group of groups) {
    if (signal?.aborted) throw new CilError('CIL memory prefix validation cancelled', group.offset);
    let seen = 0;
    for (const prefix of group.prefixes) {
      if (!Object.hasOwn(checks, prefix.name)) continue;
      const check = checks[prefix.name];
      if (seen & check.bit) reject('CILPM0001', prefix, group);
      seen |= check.bit;
      check.validate(prefix, group, allowUnverifiable);
    }
  }
  return groups;
}
