function intrinsicMembers(builtin, owner, api) {
  const shape = api.builtinMemberShape(builtin);
  const receiverCount = shape.instance ? 1 : 0;
  const parameters = builtin.params.slice(receiverCount).map((type, index) => ({
    name: 'arg' + index, type: api.builtinParameterType(builtin, type)
  }));
  const type = builtin.result === 'numeric' ? 'double' : builtin.result;
  const kind = shape.property ? 'property' : shape.name === 'new' ? 'constructor' : 'method';
  const name = kind === 'constructor' ? '.ctor' : shape.name;
  const prefix = (shape.instance || kind === 'constructor' ? '' : 'static ') + (kind === 'constructor' ? '' : type + ' ');
  if (shape.property) return [{token: 'builtin:' + builtin.id, name, owner, kind, type, isStatic: !shape.instance,
    parameters: [], signature: prefix + name + ' { get; }', builtinId: builtin.id}];
  const members = [];
  // The runtime's accepted arity range is projected as source-callable signatures; no CLR overloads are invented.
  for (let count = builtin.min - receiverCount; count <= builtin.max - receiverCount; count++) {
    const selected = parameters.slice(0, count);
    const signatureName = kind === 'constructor' ? owner.split('.').at(-1) : name;
    members.push({token: 'builtin:' + builtin.id + ':' + count, name, owner, kind, type, parameters: selected,
      isStatic: !shape.instance && kind !== 'constructor', builtinId: builtin.id,
      signature: prefix + signatureName + '(' + selected.map(parameter => parameter.type + ' ' + parameter.name).join(', ') + ');'});
  }
  return members;
}

/** The core builtin catalog is separate from registered framework contributions; use the compiler's shared shape contract. */
export async function intrinsicMetadata() {
  const api = await import('@sharpforge/bytecode');
  const types = new Map();
  // Stable IDs reserve sparse array ranges; the public name index visits only real descriptors.
  for (const builtin of api.BuiltinMap.values()) {
    if (!builtin || builtin.contract || builtin.name.startsWith('$')) continue;
    const prefix = builtin.name.slice(0, builtin.name.lastIndexOf('.'));
    const owner = api.builtinOwners[prefix];
    if (!owner) continue;
    if (!types.has(owner)) types.set(owner, {token: owner, name: owner, displayName: owner, kind: 'class',
      namespace: owner.slice(0, owner.lastIndexOf('.')), signature: 'class ' + owner, members: []});
    types.get(owner).members.push(...intrinsicMembers(builtin, owner, api));
  }
  return {types: [...types.values()], aliases: api.builtinOwners, version: api.FORMAT_VERSION};
}
