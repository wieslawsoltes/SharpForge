import {CilError} from './binary.js';

/** Resolve aliases in O(slots + aliases), retaining the existing declaration identities. */
export function indexDispatchTable(table, resolveSlot) {
  const slotIndexes = new Map();
  const targets = [];
  const resolved = new Map();
  const active = new Set();
  for (const initial of new Set([...table.slots.keys(), ...table.aliases.keys()])) {
    const path = [];
    let slot = initial;
    while (table.aliases.has(slot) && !resolved.has(slot)) {
      if (active.has(slot)) throw new CilError('Cyclic MethodImpl slot mapping');
      active.add(slot);
      path.push(slot);
      slot = table.aliases.get(slot);
    }
    const target = resolved.has(slot) ? resolved.get(slot) : resolveSlot(table, slot);
    resolved.set(slot, target);
    for (const alias of path) {
      resolved.set(alias, target);
      active.delete(alias);
    }
    slotIndexes.set(initial, targets.length);
    targets.push(target);
  }
  const declarationsByToken = new Map();
  for (const declaration of table.declarationDetails.values()) {
    let owners = declarationsByToken.get(declaration.token);
    if (!owners) declarationsByToken.set(declaration.token, owners = new Map());
    owners.set(declaration.owner, slotIndexes.get(declaration.slot));
  }
  return Object.assign(table, {slotIndexes, targets: Object.freeze(targets), declarationsByToken});
}
