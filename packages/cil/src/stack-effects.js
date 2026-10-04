import { CilOpcodes } from './opcodes/catalog.js';

function count(behaviour) {
  return behaviour.endsWith('0') ? 0 : behaviour.split('_').length;
}

const fixedEffects = new Map(Object.values(CilOpcodes).map(opcode => [opcode.name,
  opcode.stackBehaviourPop.startsWith('Var') || opcode.stackBehaviourPush.startsWith('Var') ? null
    : Object.freeze({ pops: count(opcode.stackBehaviourPop), pushes: count(opcode.stackBehaviourPush) }),
]));

/** Immutable fixed evaluation-stack effect from the canonical opcode catalog, or null for variable/unknown opcodes. */
export function fixedStackEffect(name) {
  return fixedEffects.get(name) ?? null;
}
