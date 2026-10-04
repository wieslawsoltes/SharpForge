import {Op, sourceNullableElement} from '@sharpforge/bytecode';

/** Canonical nullable operations use actual CLI constructors, methods and value-type receiver addresses. */
export function emitSourceNullable(writer, context, {op, a, b, getScratch, input}) {
  if (op !== Op.NULLABLE) return false;
  const owner = context.image.constants[a], element = sourceNullableElement(owner);
  if (b === 0) {
    const slot = getScratch(owner, 987);
    writer.local('ldloca', slot).op('initobj', context.resolveType(owner)).local('ldloc', slot);
    return true;
  }
  if (b === 1) {
    writer.op('newobj', context.external(owner, '.ctor', 'void', ['!0'], false));
    return true;
  }
  if (b === 6 && input.at(-1) === owner + '&') {
    writer.op('call', context.external(owner, 'ToString', 'string', [], false));
    return true;
  }
  const receiver = getScratch(owner, 988), fallback = b === 5 ? getScratch(element, 989) : null;
  if (fallback !== null) writer.local('stloc', fallback);
  writer.local('stloc', receiver).local('ldloca', receiver);
  if (fallback !== null) writer.local('ldloc', fallback);
  const name = b === 2 ? 'get_HasValue' : b === 3 ? 'get_Value' : b === 6 ? 'ToString' : 'GetValueOrDefault';
  const result = b === 2 ? 'bool' : b === 6 ? 'string' : '!0';
  writer.op('call', context.external(owner, name, result, b === 5 ? ['!0'] : [], false));
  return true;
}
