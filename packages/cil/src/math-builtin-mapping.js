import {Builtins, numericTypeName} from '@sharpforge/bytecode';

const mathBuiltins = Object.values(Builtins).filter(builtin => builtin.math);

/** Emit a marked typed call; the released numeric Min/Max spans have no terminal nop. */
export function emitMathBuiltin(context, writer, builtin, types, adapt) {
  if (!builtin.math) return false;
  const {owner, name, signature} = builtin.math;
  adapt(types, signature.parameters);
  writer.op('call', context.external(owner, name, signature.returnType, signature.parameters, true)).op('nop');
  return true;
}

/** Match the exact signature and terminal call+nop; loadAssembly validates the complete canonical span. */
export function decodeMathBuiltin(target, span) {
  const signature = target.sig;
  if (target.owner !== 'System.Math' || signature?.kind !== 'method' || signature.isStatic !== true ||
      signature.genericArity || signature.callingConvention || signature.explicitThis || signature.sentinel != null) return null;
  if (span.at(-1)?.name !== 'nop' || span.at(-2)?.name !== 'call' || span.at(-2).operand !== target.token ||
      span.filter(instruction => ['call', 'callvirt', 'newobj'].includes(instruction.name)).length !== 1) return null;
  return mathBuiltins.find(builtin => target.name === builtin.math.name &&
    numericTypeName(signature.returnType) === builtin.result && signature.parameters.length === 2 &&
    signature.parameters.every((type, index) => numericTypeName(type) === builtin.params[index])) ?? null;
}
