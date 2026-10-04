import {Builtins, builtinOwners} from '@sharpforge/bytecode';

export const visibleRegistryBuiltins = () => Builtins.filter(builtin => !builtin.contract &&
  (!builtin.name.startsWith('$') || builtin.synchronization || builtin.varargs));

export function registryBuiltinOwner(builtin) {
  return builtin.synchronization?.owner ?? builtin.varargs?.owner ??
    builtinOwners[builtin.name.slice(0, builtin.name.lastIndexOf('.'))];
}

export function indexRegistryBuiltins(bridge) {
  for (const builtin of bridge.builtins) {
    const owner = registryBuiltinOwner(builtin);
    if (!owner) continue;
    if (!bridge.builtinsByOwner.has(owner)) bridge.builtinsByOwner.set(owner, []);
    bridge.builtinsByOwner.get(owner).push(builtin);
  }
}
