import {findContracts} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';

/** Native vector models and heap-backed collections share the same registered mutation path. */
export function invokeManagedCollectionOperation(context, receiver, name, args) {
  if (context.model(receiver)) {
    const contract = findContracts(context.typeOf(receiver), name, false)
      .find(member => member.parameters.length === args.length);
    if (contract) {
      const result = context.registry.invoke(context, contract, receiver, args);
      if (result.handled) {
        context.modelState.sync(receiver);
        return result.value;
      }
    }
  }
  return context.platform.collection(receiver, name, args);
}

function arrayRecord(context, value) {
  if (!isReference(value)) throw new ManagedFault('ArgumentException', 'A managed array is required');
  const record = context.platform.heap.get(value);
  if (record.kind !== 'array') throw new ManagedFault('ArgumentException', 'A managed array is required');
  return record;
}

function requireIndex(record, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= record.data.length) {
    throw new ManagedFault('IndexOutOfRangeException', 'Array index is outside the target');
  }
}

export function managedArrayLength(context, value) { return arrayRecord(context, value).data.length; }

export function managedArrayGet(context, value, index) {
  const record = arrayRecord(context, value);
  requireIndex(record, index);
  return context.native(record.data[index]);
}

export function managedArraySet(context, value, index, item) {
  const record = arrayRecord(context, value);
  requireIndex(record, index);
  return context.platform.heap.withRoots([value, item], () => {
    const managed = context.managed(item, record.type.slice(0, -2));
    const oldValue = record.data[index];
    record.data[index] = managed;
    context.platform.vm.notifyWrite({kind: 'element', handle: value.h, generation: value.g, index, oldValue, value: managed});
    return managed;
  });
}
