import {isControlExecutableOpcode, controlStackEffect} from './control-execution-profile.js';
import {indirectCallStackEffect} from './function-pointer-profile.js';
import {isMemoryExecutableOpcode, memoryStackEffect} from './execution-memory-profile.js';

// Broad decoding remains separate from the managed execution allowlist.
const simple = new Set([
  'calli', 'constrained.', 'volatile.', 'ldtoken', 'ldftn', 'ldvirtftn', 'nop', 'break', 'ldnull', 'dup', 'pop',
  'ret', 'switch', 'ldstr', 'newobj', 'call', 'callvirt', 'throw', 'rethrow', 'endfinally', 'ldlen', 'newarr',
  'ldfld', 'stfld', 'ldsfld', 'stsfld', 'ldflda', 'ldsflda', 'ldobj', 'stobj', 'initobj', 'ldelema', 'ldelem',
  'stelem', 'box', 'unbox', 'unbox.any', 'cpobj', 'sizeof', 'castclass', 'isinst', 'ckfinite'
]);
const arithmetic = /^(add|sub|mul)(\.ovf(\.un)?)?$|^(div|rem|shr)(\.un)?$|^(and|or|xor|shl|neg|not|ceq|cgt|clt)(\.un)?$/;
const indexed = /^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.[0-3s])?$/;
const numeric = /^ldc\.(i4(\.(m1|[0-8]|s))?|i8|r4|r8)$/;
const branches = /^(br|brtrue|brfalse|leave)(\.s)?$|^(beq|bge|bgt|ble|blt|bne)(\.un)?(\.s)?$/;
const conversions = /^conv\.(ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(\.un)?$/;
const memory = /^(ldelem|stelem|ldind|stind)\.(i1|u1|i2|u2|i4|u4|i8|i|r4|r8|ref)$/;

export const isIndexedOpcode = name => indexed.test(name);

export function isExecutableOpcode(name) {
  return simple.has(name) || isControlExecutableOpcode(name) || isMemoryExecutableOpcode(name) || arithmetic.test(name) || indexed.test(name) ||
    numeric.test(name) || branches.test(name) || conversions.test(name) || memory.test(name);
}

/** Stack accounting is shared by bounded CFG admission and pointer-flow verification. */
export function stackEffect(inspector, method, instruction) {
  const n = instruction.name;
  const effect = controlStackEffect(method, instruction) ?? memoryStackEffect(instruction);
  if (effect) return effect;
  if (['constrained.', 'volatile.', 'nop', 'break', 'endfinally', 'rethrow'].includes(n) ||
      /^br(\.s)?$/.test(n) || /^leave/.test(n)) return [0, 0];
  if (['ldtoken', 'ldftn', 'sizeof', 'ldnull', 'ldstr', 'ldsfld', 'ldsflda'].includes(n) ||
      numeric.test(n) || /^ld(arg|loc)/.test(n)) return [0, 1];
  if (/^st(arg|loc)/.test(n) || ['pop', 'stsfld', 'throw', 'switch', 'initobj'].includes(n) ||
      /^br(true|false)/.test(n)) return [1, 0];
  if (n === 'dup') return [1, 2];
  if (n === 'ret') return [method.signature.returnType === 'void' ? 0 : 1, 0];
  if (n === 'calli') return indirectCallStackEffect(inspector, instruction);
  if (n === 'call' || n === 'callvirt' || n === 'newobj') {
    const descriptor = inspector.resolveToken(instruction.operand);
    return [descriptor.signature.parameters.length + (n !== 'newobj' && !descriptor.signature.isStatic ? 1 : 0),
      n === 'newobj' || descriptor.signature.returnType !== 'void' ? 1 : 0];
  }
  if (['cpobj', 'stfld', 'stobj'].includes(n) || n.startsWith('stind.')) return [2, 0];
  if (n === 'stelem' || n.startsWith('stelem.')) return [3, 0];
  if (n === 'ldelema' || n === 'ldelem' || n.startsWith('ldelem.')) return [2, 1];
  if (/^b(eq|ge|gt|le|lt|ne)/.test(n)) return [2, 0];
  if (arithmetic.test(n) && !['neg', 'not'].includes(n)) return [2, 1];
  return [1, 1];
}
