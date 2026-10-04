import {decodeCoded} from './metadata/indices.js';
import {CilError} from './binary.js';
import {frameworkType} from '@sharpforge/framework';

/**
 * Emit a source-image framework call. Explicit sourceBridge entries are internal ABI
 * adapters; imported native CIL still resolves the original contract and signature.
 */
export function emitFrameworkBuiltin(context, writer, descriptor, input, services) {
  const selected = descriptor.sourceBridge ? {...descriptor, ...descriptor.sourceBridge} : descriptor;
  const constructor = selected.kind === 'constructor';
  const instance = !selected.isStatic && !constructor;
  const parameters = [...(instance ? [selected.owner] : []), ...selected.parameters];
  services.adapt(input, parameters);
  const valueReceiver = frameworkType(selected.owner)?.kind === 'value';
  if (instance && valueReceiver) {
    const slots = [];
    for (let index = parameters.length - 1; index >= 0; index--) {
      const slot = services.getScratch(parameters[index], 2000 + index);
      slots[index] = slot;
      writer.local('stloc', slot);
    }
    writer.op('ldloca', slots[0]);
    for (let index = 1; index < slots.length; index++) writer.local('ldloc', slots[index]);
  }
  const opcode = constructor ? 'newobj' : selected.isStatic || valueReceiver ? 'call' : 'callvirt';
  writer.op(opcode, context.external(selected.owner, selected.name,
    constructor ? 'void' : selected.result, selected.parameters, selected.isStatic));
  if (!constructor && selected.result === 'void') writer.op('ldnull');
}


/** Retain only the explicitly supported GC bases when reconstructing a compiler profile image. */
export function gcProfileBase(metadata, row) {
  const name = row[3] ? metadata.typeName(decodeCoded('TypeDefOrRef', row[3])) : 'System.Object';
  if (name === 'System.Object') return {};
  if (name === 'System.Runtime.InteropServices.SafeHandle' || name === 'System.Runtime.ConstrainedExecution.CriticalFinalizerObject') {
    return {base: name};
  }
  throw new CilError('Unsupported base type in compiler profile: ' + name);
}
