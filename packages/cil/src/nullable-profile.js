import {canonicalType} from '@sharpforge/framework';

/** Approved UI nullable values; arbitrary generic value types remain outside this execution profile. */
export const nullableScalarTypes = Object.freeze(['int', 'uint', 'bool', 'float', 'double']);
export const nullableValueTypes = Object.freeze([...nullableScalarTypes, 'System.DateTimeOffset', 'System.TimeSpan']);
const values = new Set(nullableValueTypes);
const scalarAliases = new Map([
  ['System.Int32', 'int'], ['System.UInt32', 'uint'], ['System.Boolean', 'bool'],
  ['System.Single', 'float'], ['System.Double', 'double']
]);

export function nullableElementType(type) {
  if (typeof type !== 'string' || type.length > 128) return null;
  if (!type.endsWith('?') && !type.startsWith('System.Nullable')) return null;
  const element = type.endsWith('?') ? type.slice(0, -1) : /^System\.Nullable(?:`1)?<([^<>]+)>$/.exec(type)?.[1];
  if (!element) return null;
  const spelling = element.trim();
  const name = scalarAliases.get(spelling) ?? canonicalType(spelling);
  return values.has(name) ? name : null;
}

export function nullableSignatureType(type) {
  const element = nullableElementType(type);
  return element ? element + '?' : canonicalType(type);
}
