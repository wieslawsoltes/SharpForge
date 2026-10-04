import {numericTypeName} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {cliSystemName} from './metadata.js';
import {scalarMetadataType} from './scalar-emission.js';
import {encodeTypeSignature} from './metadata/signature-writer.js';

const aliases = {'System.Boolean': 'bool', 'System.String': 'string', 'System.Object': 'object',
  'System.Exception': 'Exception', 'Array': 'System.Array'};
export const memoryTypeName = type => (aliases[type] ?? numericTypeName(type)).replace(/System\.(ReadOnlySpan|Span)`1</g, 'System.$1<');
export const valueTypeName = type => type.replace(/&$/, '');
export function arrayElementType(type) {
  const match = /^(.*)\[([,*]*)\]$/.exec(type);
  if (!match) throw new CilError('Expected an array storage type');
  return match[1];
}
export function spanElementType(type) {
  const match = /^System\.(?:ReadOnly)?Span(?:`1)?<(.*)>$/.exec(valueTypeName(type));
  if (!match) throw new CilError('Expected a closed Span storage type');
  return match[1];
}

/** MemberRef owners and inline type operands use TypeSpec for constructed storage shapes. */
export function resolveSourceType(context, type) {
  const existing = context.typeTokens.get(type);
  if (existing) return existing;
  type = memoryTypeName(type);
  if (/[\[<&*]/.test(type) && context.signatures) {
    const cache = context.sourceTypeSpecs ??= new Map();
    if (!cache.has(type)) cache.set(type, context.metadata.add(27, [context.metadata.blob(
      encodeTypeSignature(context.signatures.type(type), {context: 'return'}))]));
    return cache.get(type);
  }
  return context.metadata.typeRef(cliSystemName(scalarMetadataType(type)));
}
