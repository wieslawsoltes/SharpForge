const primitiveValues = new Set([
  'bool', 'char', 'byte', 'sbyte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal', 'nint', 'nuint'
]);
const intrinsicTypes = new Set([...primitiveValues,
  'void', 'object', 'string', 'System.Enum', 'System.ValueType', 'System.MulticastDelegate'
]);

function nullableArgument(type) {
  if (type.endsWith('?')) return type.slice(0, -1);
  for (const prefix of ['System.Nullable`1<', 'System.Nullable<']) {
    if (type.startsWith(prefix) && type.endsWith('>')) return type.slice(prefix.length, -1);
  }
  return null;
}

/** Validate closed signatures without treating undeclared generic types as registered types. */
export function isKnownSignatureType(type, types, depth = 0) {
  if (typeof type !== 'string' || type.length > 4096 || depth > 32) return false;
  if (intrinsicTypes.has(type) || types.has(type)) return true;
  if (type.endsWith('[]')) return isKnownSignatureType(type.slice(0, -2), types, depth + 1);
  if (type.endsWith('&')) {
    return !type.endsWith('&&') && type !== 'void&' && isKnownSignatureType(type.slice(0, -1), types, depth + 1);
  }
  const argument = nullableArgument(type);
  if (!argument) return false;
  const kind = types.get(argument)?.kind;
  return primitiveValues.has(argument) || kind === 'value' || kind === 'enum';
}
