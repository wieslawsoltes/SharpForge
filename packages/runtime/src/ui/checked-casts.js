import {castReference, castCacheFor} from '../execution/casting.js';
import {ManagedFault, isReference} from '../heap.js';
import {copyFrameworkValue} from '../execution/framework-values.js';

/** UI object-returning APIs preserve boxed value identity until an explicitly checked unboxing cast. */
export function checkedUICast(context, value, name) {
  const {heap, vm} = context.platform;
  const target = heap.methodTables.get(name);
  if (!target.flags.valueType) return castReference(heap, value, target);
  if (value === null) throw new ManagedFault('NullReferenceException', 'Cannot unbox a null UI value');
  if (!isReference(value)) throw new ManagedFault('InvalidCastException', 'A boxed UI value is required');
  const record = heap.get(value);
  if (record.kind !== 'box' || record.methodTable !== target) {
    throw new ManagedFault('InvalidCastException', 'Boxed UI value type mismatch');
  }
  // CIL has a following unbox.any; the source image stores the result directly in its typed temporary.
  return vm.inspector ? value : copyFrameworkValue(vm, record.data[0], name);
}

export function isUIInstance(context, value, name) {
  if (value === null || !isReference(value)) return false;
  const heap = context.platform.heap;
  const target = heap.methodTables.get(name);
  return castCacheFor(heap.methodTables).isAssignableFrom(target, heap.get(value).methodTable);
}

/** Avoid reboxing the source engine's checked result at the generic object-return boundary. */
export function isSourceUICast(context, descriptor) {
  return !context.platform.vm.inspector && descriptor.owner === 'SharpForge.UI.Runtime' && descriptor.name === 'Cast';
}

/** The compiler supplies the operand's declared value type, so an integral Double never becomes an Int32 box. */
export function boxUIValue(context, value, name) {
  const {heap, vm} = context.platform;
  const target = heap.methodTables.get(name);
  if (!target.flags.valueType) throw new ManagedFault('InvalidCastException', 'UI boxing requires a value type');
  if (isReference(value)) {
    const record = heap.get(value);
    if (record.kind === 'box') {
      if (record.methodTable !== target) throw new ManagedFault('InvalidCastException', 'Boxed UI value type mismatch');
      return value;
    }
    if (record.methodTable !== target) throw new ManagedFault('InvalidCastException', 'UI value type mismatch');
  } else if (value === null || value === undefined || typeof value === 'string') {
    throw new ManagedFault('InvalidCastException', 'Invalid UI value for boxing');
  }
  const stored = vm.inspector ? vm.storage(value, name) : copyFrameworkValue(vm, value, name);
  return heap.allocate('box', target, [stored]);
}
