import {CilError} from './binary.js';
import {callSignatureKey} from './call-profile.js';

/** Materialize aliases once. Dispatch thereafter indexes an immutable target vector. */
export function indexDispatchTable(table, resolveSlot) {
  const slotIndexes = new Map();
  const targets = [];
  const declarationsByToken = new Map();
  const externalSlots = new Map();
  for (const declaration of table.declarations.values()) {
    let index = slotIndexes.get(declaration.slot);
    if (index === undefined) {
      index = targets.length;
      slotIndexes.set(declaration.slot, index);
      targets.push(resolveSlot(table, declaration.slot));
    }
    if (declaration.external) {
      let methods = externalSlots.get(declaration.owner);
      if (!methods) externalSlots.set(declaration.owner, methods = new Map());
      let signatures = methods.get(declaration.name);
      if (!signatures) methods.set(declaration.name, signatures = new Map());
      signatures.set(callSignatureKey(declaration.signature), index);
    } else {
      let owners = declarationsByToken.get(declaration.token);
      if (!owners) declarationsByToken.set(declaration.token, owners = new Map());
      owners.set(declaration.owner, index);
    }
  }
  return Object.assign(table, {slotIndexes, targets: Object.freeze(targets), declarationsByToken, externalSlots});
}

/** A null owner is unambiguous only when one closed declaration exists on the receiver. */
export function declarationSlot(table, token, owner = null) {
  const owners = table.declarationsByToken.get(token);
  if (!owners || (owner === null && owners.size !== 1) || (owner !== null && !owners.has(owner))) {
    throw new CilError('Virtual receiver is incompatible or ambiguous for the method declaration');
  }
  return owner === null ? owners.values().next().value : owners.get(owner);
}
