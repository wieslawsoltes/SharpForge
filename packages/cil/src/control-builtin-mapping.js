import {
  Builtins
} from '@sharpforge/bytecode';
import {
  normalizeCallType
} from './call-profile.js';
import {emitGenericSynchronization} from './synchronization-builtin-mapping.js';

const profiles = Object.values(Builtins).filter(entry => entry.exceptionRuntime || entry.synchronization || entry.varargs);
const profile = entry => entry.exceptionRuntime ?? entry.synchronization ?? entry.varargs;

/** Emit exact finite control contracts without changing the released name-based mappings. */
export function emitControlBuiltin(context, writer, builtin, types, adapt) {
  const descriptor = profile(builtin);
  if (!descriptor) return false;
  if (builtin.synchronization && descriptor.genericArity) {
    emitGenericSynchronization(context, writer, descriptor, types, adapt);
    return true;
  }
  const constructor = descriptor.name === '.ctor';
  adapt(types, [...(!descriptor.isStatic && !constructor ? [descriptor.owner] : []), ...descriptor.parameters]);
  writer.op(constructor ? 'newobj' : descriptor.isStatic ? 'call' : 'callvirt',
    context.external(descriptor.owner, descriptor.name, descriptor.returnType, descriptor.parameters, descriptor.isStatic));
  if (descriptor.returnType === 'void' && !constructor) writer.op('ldnull');
  return true;
}

export function decodeControlBuiltin(target) {
  const signature = target.sig;
  if (!signature || signature.callingConvention || signature.explicitThis || signature.sentinel != null) return null;
  return profiles.find(entry => {
    const descriptor = profile(entry);
    return (signature.genericArity ?? 0) === (descriptor.genericArity ?? 0) &&
      (!signature.genericArity || target.methodArguments?.length === signature.genericArity) &&
      normalizeCallType(target.owner) === normalizeCallType(descriptor.owner) && target.name === descriptor.name &&
      !!signature.isStatic === !!descriptor.isStatic &&
      normalizeCallType(signature.returnType) === normalizeCallType(descriptor.returnType) &&
      signature.parameters.length === descriptor.parameters.length && signature.parameters.every((type, index) =>
        normalizeCallType(type) === normalizeCallType(descriptor.parameters[index]));
  }) ?? null;
}
