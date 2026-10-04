import { fail } from './contracts.js';

function checkedMethod(token, count) {
  if (!Number.isInteger(token) || token < 0x06000001 || token > 0x06000000 + count)
    fail('Invalid local slot method token');
}

/** Without bound PE metadata, a missing PDB row cannot establish either an unnamed slot or an empty signature. */
export function unavailableLocalSlots(methodCount) {
  return (methodToken) => {
    checkedMethod(methodToken, methodCount);
    return { available: false, reason: 'type-metadata-required', slots: [] };
  };
}

/** Snapshot exact declarations separately from storage slots; no source name, lexical lifetime or optimized-away variable is inferred. */
export function createLocalSlotLookup(methods, signatures, scopes, displays, limits) {
  const types = new Map(),
    declarations = new Map();
  for (const [token, signature] of signatures) {
    types.set(
      token,
      signature.map((type) => ({ type, typeName: displays.format(type) })),
    );
  }
  for (const scope of scopes) {
    let method = declarations.get(scope.methodToken);
    if (!method) declarations.set(scope.methodToken, (method = new Map()));
    for (const local of scope.variables) {
      let slot = method.get(local.index);
      if (!slot) method.set(local.index, (slot = []));
      slot.push({
        id: local.id,
        scopeId: scope.id,
        start: scope.start,
        end: scope.end,
        name: local.name,
        attributes: local.attributes,
        compilerGenerated: local.hidden,
      });
    }
  }
  return ownedLookup(methods, types, declarations, limits);
}

function ownedLookup(methods, types, declarations, limits) {
  return (methodToken) => {
    limits.check();
    checkedMethod(methodToken, methods.size);
    const { token, reason } = methods.get(methodToken);
    if (reason) return { available: false, reason, slots: [] };
    const names = declarations.get(methodToken);
    const slots = (types.get(token) ?? []).map((type, index) => {
      const recorded = names?.get(index) ?? [];
      return {
        index,
        ...type,
        name: recorded.length === 1 ? recorded[0].name : null,
        unnamed: !recorded.length,
        declarations: recorded,
      };
    });
    return { available: true, reason: null, slots: structuredClone(slots) };
  };
}
