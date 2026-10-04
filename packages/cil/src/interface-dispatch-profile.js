/** Preserve ambiguity until invocation; unrelated members of the type remain usable. */
export const ambiguousImplementation = Object.freeze({ambiguousImplementation: true});

export function inheritInterfaceCandidates(tables) {
  const candidates = new Map();
  for (const table of tables) {
    for (const [slot, methods] of table.interfaceCandidates ?? []) {
      for (const [owner, method] of methods) addInterfaceCandidate(candidates, slot, owner, method);
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
  const superseded = new Set();
  for (const owner of methods.keys()) {
    for (const ancestor of dispatch.table(owner).instances) {
      if (ancestor !== owner && methods.has(ancestor)) superseded.add(ancestor);
    }
  }
  return [...methods].filter(([owner]) => !superseded.has(owner)).map(([, method]) => method);
}

/** Class implementations dominate DIM; interface owners compete only by inheritance. */
export function completeInterfaceSlots(dispatch, table) {
  for (const [slot, methods] of table.interfaceCandidates) {
    const existing = dispatch.resolveSlot(table, slot);
    const method = dispatch.inspector.methods.get(existing);
    if (method && !(dispatch.types.get(method.ownerToken)?.flags & 0x20)) continue;
    const candidates = mostSpecific(dispatch, methods);
    table.aliases.delete(slot);
    table.slots.set(slot, candidates.length === 1 ? candidates[0] : ambiguousImplementation);
    table.interfaceSelections.set(slot, Object.freeze(candidates));
  }
}

/** Qualify all competing executable bodies before admitting an ambiguous runtime call. */
export function interfaceReachableTargets(table, slot, inspector) {
  return (table.interfaceSelections.get(slot) ?? []).filter(token => {
    const method = inspector.methods.get(token);
    return method?.hasBody && !(method.flags & 0x400);
  });
}
