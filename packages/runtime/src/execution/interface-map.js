import {CilError} from '@sharpforge/cil';

/** Interface views index the same target vector used by class virtual declarations. */
export function interfaceMap(table, methods, types) {
  const interfaces = new Map();
  for (const [methodToken, slot] of table.declarations) {
    const method = methods.get(methodToken);
    if (!(types.get(method?.ownerToken)?.flags & 0x20)) continue;
    let declarations = interfaces.get(method.ownerToken);
    if (!declarations) interfaces.set(method.ownerToken, declarations = new Map());
    declarations.set(methodToken, table.slotIndexes.get(slot));
  }
  return interfaces;
}

export function interfaceTarget(table, interfaces, ownerToken, methodToken) {
  const index = interfaces?.get(ownerToken)?.get(methodToken);
  if (index === undefined) throw new CilError('Virtual receiver is incompatible with the method declaration');
  return table.targets[index];
}
