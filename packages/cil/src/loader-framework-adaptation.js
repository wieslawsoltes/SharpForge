import {Op, frameworkBuiltin} from '@sharpforge/bytecode';
import {intrinsicDefinition} from './intrinsic-profile.js';

/** Nullable initialization and compiler-owned byref cells are accepted only inside byte-verified emitted spans. */
export const isFrameworkAdaptationOpcode = name => name === 'initobj' || name === 'ldflda';

/** Reuse the verifier's exact signature lookup, including approved nullable CLR spellings and return/static identity. */
export function resolveCanonicalFrameworkContract(call) {
  return intrinsicDefinition({kind: 'method', owner: call.owner, name: call.name, signature: call.sig})?.contract ?? null;
}

/** A framework call can contain delegate/nullable constructors used only to adapt its arguments. */
export function decodeFrameworkAdaptation(span, context) {
  let lastCall = null;
  let count = 0;
  for (const instruction of span) {
    if (instruction.name !== 'call' && instruction.name !== 'callvirt' && instruction.name !== 'newobj') continue;
    lastCall = instruction;
    count++;
  }
  if (count < 2) return null;
  const call = context.resolveCall(lastCall.operand);
  const contract = resolveCanonicalFrameworkContract(call);
  if (!contract) return null;
  const builtin = frameworkBuiltin(contract);
  return [Op.BUILTIN, builtin.id, builtin.min];
}
