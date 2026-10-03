import {ManagedFault} from '../heap.js';

/** Per-closed-type interface maps point at the same indexed virtual target vector. */
export function interfaceMap(table, methods, types) {
  const interfaces = new Map();
  for (const [methodToken, owners] of table.declarationsByToken) {
    const method = methods.get(methodToken);
    const declaringType = method && types.get(method.ownerToken);
    if (!(declaringType?.flags & 0x20)) continue;
    for (const [owner, index] of owners) {
      let slots = interfaces.get(owner);
      if (!slots) interfaces.set(owner, slots = new Map());
      slots.set(methodToken, index);
    }
  }
  return interfaces;
}

export function interfaceTarget(table, interfaces, owner, methodToken) {
  const index = interfaces.get(owner)?.get(methodToken);
  if (index === undefined) throw new ManagedFault('InvalidCastException', 'Receiver does not implement the interface declaration');
  return table.targets[index];
}
