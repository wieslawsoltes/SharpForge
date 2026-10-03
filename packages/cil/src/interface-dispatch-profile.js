/** An ambiguity is retained until invocation, rather than rejecting an otherwise usable type. */
export const ambiguousImplementation = Object.freeze({ambiguousImplementation: true});

export function inheritInterfaceCandidates(tables) {
  const candidates = new Map();
  for (const table of tables) {
    for (const [slot, methods] of table.interfaceCandidates ?? []) {
      let inherited = candidates.get(slot);
      if (!inherited) candidates.set(slot, inherited = new Map());
      for (const [owner, method] of methods) inherited.set(owner, method);
    }
  }
  return candidates;
}

export function addInterfaceCandidate(candidates, slot, owner, methodToken) {
  let methods = candidates.get(slot);
  if (!methods) candidates.set(slot, methods = new Map());
  methods.set(owner, methodToken);
}

function mostSpecific(dispatch, methods) {
  const maximal = [];
  for (const [owner, method] of methods) {
    let superseded = false;
    for (const other of methods.keys()) {
      if (owner !== other && dispatch.table(other).instances.has(owner)) {
        superseded = true;
        break;
      }
    }
    if (!superseded) maximal.push(method);
  }
  return maximal.length === 1 ? maximal[0] : ambiguousImplementation;
}

/** Class implementations dominate DIM; otherwise select the unique most-specific interface owner. */
export function completeInterfaceSlots(dispatch, table) {
  for (const [slot, methods] of table.interfaceCandidates) {
    const existing = dispatch.resolveSlot(table, slot);
    const method = dispatch.inspector.methods.get(existing);
    const owner = method && dispatch.types.get(method.ownerToken);
    if (method && !(owner?.flags & 0x20)) continue;
    table.aliases.delete(slot);
    table.slots.set(slot, mostSpecific(dispatch, methods));
  }
}

/** The verifier visits all competing bodies so an ambiguous call can fault at runtime safely. */
export function interfaceReachableTargets(table, slot, inspector) {
  const methods = table.interfaceCandidates.get(slot);
  return [...(methods?.values() ?? [])].filter(token => {
    const method = inspector.methods.get(token);
    return method?.hasBody && !(method.flags & 0x400);
  });
}
