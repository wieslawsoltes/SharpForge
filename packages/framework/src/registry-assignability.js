/** Traverse declared base/interface edges with cycle protection; no host type inference. */
export function registryAssignable(types, canonicalType, target, source) {
  target = canonicalType(target);
  source = canonicalType(source);
  if (target === source || target === 'object' && source !== 'void') return true;
  const pending = [source];
  const seen = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (name === target) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    const type = types.get(name);
    if (!type) continue;
    if (type.base) pending.push(canonicalType(type.base));
    for (const implemented of type.interfaces ?? []) pending.push(canonicalType(implemented));
  }
  return false;
}

/** Registry interfaces must name declared interface types, never unresolved or cyclic edges. */
export function validateRegistryInterfaces(types) {
  const done = new Set();
  const active = new Set();
  function visit(name) {
    if (done.has(name)) return;
    if (active.has(name)) throw new Error('[registry] Cyclic interface metadata: ' + name);
    const type = types.get(name);
    if (type.interfaces !== undefined && !Array.isArray(type.interfaces)) {
      throw new Error('[registry] Invalid interfaces on ' + name);
    }
    active.add(name);
    for (const implemented of type.interfaces ?? []) {
      const target = types.get(implemented);
      if (!target || (target.typeKind ?? target.kind) !== 'interface') {
        throw new Error('[registry] Unknown interface ' + implemented + ' on ' + name);
      }
      visit(implemented);
    }
    active.delete(name);
    done.add(name);
  }
  for (const name of types.keys()) visit(name);
}
