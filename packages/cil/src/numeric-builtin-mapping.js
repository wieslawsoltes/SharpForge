import {Builtins, numericTypeName} from '@sharpforge/bytecode';

const numericBuiltins = Object.values(Builtins).filter(builtin => builtin.numeric);

/** Retain an exact CLI signature and a marked source instruction boundary. */
export function emitNumericBuiltin(context, writer, builtin, types, adapt) {
  if (!builtin.numeric) return false;
  const {owner, name, signature} = builtin.numeric;
  adapt(types, signature.parameters);
  writer.op('call', context.external(owner, name, signature.returnType, signature.parameters, true)).op('nop');
  return true;
}

/** Canonical re-emission validates the entire span after this exact descriptor match. */
export function decodeNumericBuiltin(target, span) {
  const signature = target.sig;
  if (signature?.kind !== 'method' || !Array.isArray(signature.parameters) || signature.isStatic !== true || signature.genericArity ||
      signature.callingConvention || signature.explicitThis || signature.sentinel != null ||
      span.at(-1)?.name !== 'nop' || span.at(-2)?.name !== 'call' || span.at(-2).operand !== target.token ||
      span.filter(instruction => ['call', 'callvirt', 'newobj'].includes(instruction.name)).length !== 1) return null;
  return numericBuiltins.find(builtin => target.owner === builtin.numeric.owner && target.name === builtin.numeric.name &&
    numericTypeName(signature.returnType) === builtin.result && signature.parameters.length === builtin.params.length &&
    signature.parameters.every((type, index) => numericTypeName(type) === builtin.params[index])) ?? null;
}
