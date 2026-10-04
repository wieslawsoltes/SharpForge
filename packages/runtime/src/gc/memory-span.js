import {ManagedFault} from './fault.js';

/** A readonly span owns GC-visible backing storage and never exposes mutable source indexing. */
export function invokeGCMemorySpan(platform, descriptor, args, type) {
  const receiver = args[0]?.byref ? platform.vm.dereference(args[0]) : args[0];
  const backing = platform.get(receiver, '$data');
  const data = backing ? platform.heap.get(backing).data : [];
  if (descriptor.name === 'get_Length') return {handled: true, value: data.length};
  if (descriptor.name === 'get_IsEmpty') return {handled: true, value: platform.managed(data.length === 0, 'bool')};
  if (descriptor.name === 'ToArray') {
    return {handled: true, value: platform.heap.allocate('array', type.element + '[]', [...data])};
  }
  if (descriptor.name !== 'get_Item' && descriptor.name !== '$get_ItemValue') {
    throw new ManagedFault('MissingMethodException', descriptor.name);
  }
  const index = platform.native(args[1]);
  if (!Number.isInteger(index) || index < 0 || index >= data.length) {
    throw new ManagedFault('IndexOutOfRangeException', 'ReadOnlySpan index is out of range');
  }
  if (descriptor.name === '$get_ItemValue' || !platform.vm.inspector) return {handled: true, value: data[index]};
  return {handled: true, value: Object.freeze({byref: true, kind: 'array', index, owner: backing,
    frameId: platform.vm.top?.id ?? 0, readOnly: true})};
}
