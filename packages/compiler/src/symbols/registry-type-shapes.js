import {TypeKind} from './types.js';

const kinds = Object.freeze({
  enum: TypeKind.Enum, delegate: TypeKind.Delegate, value: TypeKind.Struct, interface: TypeKind.Interface
});

export function registryTypeKind(entry) {
  return kinds[entry?.typeKind ?? entry?.kind] ?? TypeKind.Class;
}

export function registryInterfaces(bridge, name) {
  return (bridge.types.get(name)?.interfaces ?? []).map(type => bridge.typeFromName(type));
}

export function registryTypeOptions(bridge, name, kind) {
  const entry = bridge.types.get(name);
  return {
    typeKind: kind,
    isStatic: entry?.kind === 'static',
    isAbstract: entry?.isAbstract || entry?.kind === 'abstract' || kind === TypeKind.Interface,
    isSealed: entry?.isSealed ?? (kind !== TypeKind.Class && kind !== TypeKind.Interface),
    baseType: () => kind === TypeKind.Interface ? null : bridge.baseOf(name),
    interfaces: () => registryInterfaces(bridge, name),
    enumUnderlyingType: kind === TypeKind.Enum ? bridge.byName.get('int') : null
  };
}

export function registryVariance(definition, entry) {
  for (let index = 0; index < definition.typeParameters.length; index++) {
    definition.typeParameters[index].variance = entry?.variance?.[index] ?? 'none';
  }
}
