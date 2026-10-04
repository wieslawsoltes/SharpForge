const simple = new Set([
  'constrained.', 'volatile.', 'ldtoken', 'ldftn', 'nop', 'break', 'ldnull', 'dup', 'pop', 'ret', 'switch', 'ldstr',
  'newobj', 'call', 'callvirt', 'throw', 'rethrow', 'endfinally', 'ldlen', 'newarr', 'ldfld', 'stfld',
  'ldsfld', 'stsfld', 'ldflda', 'ldsflda', 'ldobj', 'stobj', 'initobj', 'ldelema', 'ldelem', 'stelem',
  'box', 'unbox', 'unbox.any', 'cpobj', 'sizeof', 'castclass', 'isinst', 'ckfinite',
]);
const arithmetic = /^(add|sub|mul)(\.ovf(\.un)?)?$|^(div|rem|shr)(\.un)?$|^(and|or|xor|shl|neg|not|ceq|cgt|clt)(\.un)?$/;
export const indexedInstructions = /^(ldarg|ldarga|starg|ldloc|ldloca|stloc)(\.[0-3s])?$/;
const numeric = /^ldc\.(i4(\.(m1|[0-8]|s))?|i8|r4|r8)$/;
const branches = /^(br|brtrue|brfalse|leave)(\.s)?$|^(beq|bge|bgt|ble|blt|bne)(\.un)?(\.s)?$/;
const conversions = /^conv\.(ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(\.un)?$/;
const indirect = /^(ldelem|stelem|ldind|stind)\.(i1|u1|i2|u2|i4|u4|i8|i|r4|r8|ref)$/;

/** Broad decoding remains separate from this managed execution allowlist. */
export function isExecutableOpcode(name) {
  return simple.has(name) || arithmetic.test(name) || indexedInstructions.test(name)
    || numeric.test(name) || branches.test(name) || conversions.test(name) || indirect.test(name);
}

/** Return [popped, pushed] slot counts; call signatures are resolved through the inspector. */
export function stackEffect(inspector, method, instruction) {
  const name = instruction.name;
  if (name === 'constrained.' || name === 'volatile.' || name === 'nop' || name === 'break' || name === 'endfinally' || name === 'rethrow'
    || /^br(\.s)?$/.test(name) || /^leave/.test(name)) return [0, 0];
  if (name === 'ldtoken' || name === 'ldftn' || name === 'sizeof' || name === 'ldnull' || name === 'ldstr'
    || numeric.test(name) || /^ld(arg|loc)/.test(name) || name === 'ldsfld' || name === 'ldsflda') return [0, 1];
  if (/^st(arg|loc)/.test(name) || name === 'pop' || name === 'stsfld' || name === 'throw' || name === 'switch'
    || /^br(true|false)/.test(name) || name === 'initobj') return [1, 0];
  if (name === 'dup') return [1, 2];
  if (name === 'ret') return [method.signature.returnType === 'void' ? 0 : 1, 0];
  if (name === 'call' || name === 'callvirt' || name === 'newobj') {
    const descriptor = inspector.resolveToken(instruction.operand);
    return [descriptor.signature.parameters.length + (name !== 'newobj' && !descriptor.signature.isStatic ? 1 : 0),
      name === 'newobj' || descriptor.signature.returnType !== 'void' ? 1 : 0];
  }
  if (name === 'cpobj' || name === 'stfld' || name === 'stobj' || name.startsWith('stind.')) return [2, 0];
  if (name === 'stelem' || name.startsWith('stelem.')) return [3, 0];
  if (name === 'ldelema' || name === 'ldelem' || name.startsWith('ldelem.')) return [2, 1];
  if (/^b(eq|ge|gt|le|lt|ne)/.test(name)) return [2, 0];
  if (arithmetic.test(name) && !['neg', 'not'].includes(name)) return [2, 1];
  return [1, 1];
}
