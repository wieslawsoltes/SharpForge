import {verifyGenericType} from './generic-profile.js';

const effects = Object.freeze({
  'localloc': Object.freeze([1, 1]),
  'cpblk': Object.freeze([3, 0]),
  'initblk': Object.freeze([3, 0]),
  'unaligned.': Object.freeze([0, 0]),
  'readonly.': Object.freeze([0, 0])
});

export const isMemoryExecutableOpcode = name => Object.hasOwn(effects, name);
export const memoryStackEffect = instruction => Object.hasOwn(effects, instruction.name) ? effects[instruction.name] : null;

/** Pinned is a local-storage qualifier, never a method parameter or result qualifier. */
export function verifyExecutionLocalType(inspector, type, context) {
  verifyGenericType(inspector, type.endsWith(' pinned') ? type.slice(0, -7) : type, context);
}
