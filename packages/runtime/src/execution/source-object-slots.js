import {sourceObjectSlot, objectSlotKey} from '@sharpforge/bytecode';
import {ManagedFault} from './managed-fault.js';

/** Retain ordinary source method identities and add only exact Object override slots. */
export function sourceVirtualSlots(image, owner) {
  const slots = [];
  for (const method of image.methods ?? []) {
    if (method.owner !== owner || method.isStatic) continue;
    slots.push([method.id, method.id]);
    if (method.objectSlot) slots.push([objectSlotKey(method.objectSlot), method.id]);
  }
  return slots;
}

export function sourceObjectOverride(vm, table, name) {
  const target = table.vtable.get(objectSlotKey(name));
  if (target === undefined) return null;
  const method = vm.image.methods[target];
  if (method?.owner !== table.name || method.objectSlot !== name || sourceObjectSlot(method) !== name) {
    throw new ManagedFault('InvalidProgramException', 'Invalid source Object override slot');
  }
  return target;
}
