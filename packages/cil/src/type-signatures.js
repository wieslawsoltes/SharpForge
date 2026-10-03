import {canonicalType, frameworkType} from '@sharpforge/framework';
import {arrayType, memoryTypeName, spanType} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {varargsTypeDefinition} from './varargs-profile.js';
import {parseFunctionPointerType} from './function-pointer-signature.js';

const elements = {
  void: 1, bool: 2, char: 3, sbyte: 4, byte: 5, short: 6, ushort: 7, int: 8, uint: 9,
  long: 10, ulong: 11, float: 12, double: 13, string: 14, typedref: 22, object: 28, nint: 24, nuint: 25,
};
export const systemNames = {
  sbyte: 'System.SByte', byte: 'System.Byte', short: 'System.Int16', ushort: 'System.UInt16', uint: 'System.UInt32',
  ulong: 'System.UInt64', float: 'System.Single', char: 'System.Char', decimal: 'System.Decimal', nint: 'System.IntPtr',
  nuint: 'System.UIntPtr', bool: 'System.Boolean', int: 'System.Int32', long: 'System.Int64', double: 'System.Double',
  typedref: 'System.TypedReference', string: 'System.String', object: 'System.Object', Exception: 'System.Exception', Array: 'System.Array',
};
const aliases = new Map(Object.entries(systemNames).map(([alias, full]) => [full, alias]));
export function cliSystemName(type) { return systemNames[type] ?? memoryTypeName(type); }

function typeToken(token) {
  const tag = [2, 1, 27].indexOf(token >>> 24);
  if (tag < 0) throw new CilError('Invalid TypeDefOrRef token');
  return ((token & 0xffffff) << 2) | tag;
}

function genericArguments(text) {
  const result = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if ('<['.includes(text[i])) depth++;
    else if ('>]'.includes(text[i])) depth--;
    else if (text[i] === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result;
}

/** ECMA-335 II.23.2: arrays, value-type generic instances, pointers and primitive ELEMENT_TYPEs. */
export function signatureType(writer, type, resolveToken) {
  type = memoryTypeName(canonicalType(type));
  type = aliases.get(type) ?? type;
  const modifier=/^(.*) mod(req|opt)\(([^()]+)\)$/.exec(type);
  if(modifier){
    writer.u8(modifier[2]==='req'?0x1f:0x20).compressed(typeToken(resolveToken(modifier[3])));
    return signatureType(writer,modifier[1],resolveToken);
  }
  if (type.endsWith('&') || type.endsWith('*')) {
    writer.u8(type.endsWith('&') ? 0x10 : 0x0f);
    return signatureType(writer, type.slice(0, -1), resolveToken);
  }
  const pointer = parseFunctionPointerType(type);
  if (pointer) {
    writer.u8(0x1b).u8((pointer.isStatic ? 0 : 0x20) | pointer.callingConvention).compressed(pointer.parameters.length);
    signatureType(writer, pointer.returnType, resolveToken);
    for (const parameter of pointer.parameters) signatureType(writer, parameter, resolveToken);
    return writer;
  }
  if (/^!!?\d+$/.test(type)) {
    writer.u8(type.startsWith('!!') ? 0x1e : 0x13).compressed(Number(type.replace(/!/g, '')));
    return writer;
  }
  const array = arrayType(type);
  if (array) {
    writer.u8(array.rank === 1 ? 0x1d : 0x14);
    signatureType(writer, array.element, resolveToken);
    if (array.rank > 1) writer.compressed(array.rank).compressed(0).compressed(0);
    return writer;
  }
  const generic = /^(.+`\d+)<(.+)>$/.exec(type);
  if (generic) {
    const args = genericArguments(generic[2]);
    const value = !!spanType(type) || frameworkType(generic[1])?.kind === 'value';
    writer.u8(0x15).u8(value ? 0x11 : 0x12).compressed(typeToken(resolveToken(generic[1]))).compressed(args.length);
    for (const argument of args) signatureType(writer, argument, resolveToken);
    return writer;
  }
  if (type in elements) return writer.u8(elements[type]);
  const value = type === 'decimal' || !!varargsTypeDefinition(type) || ['enum', 'value'].includes(frameworkType(type)?.kind);
  return writer.u8(value ? 0x11 : 0x12).compressed(typeToken(resolveToken(type)));
}
