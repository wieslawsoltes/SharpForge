import {CilError} from './binary.js';

/** Split only a trailing constructed suffix; angle fragments inside metadata names stay opaque. */
export function genericTypeParts(name) {
  if (!name.endsWith('>')) return {definition: name, arguments: []};
  let open = -1;
  let depth = 0;
  for (let index = name.length - 1; index >= 0; index--) {
    if (name[index] === '>') depth++;
    else if (name[index] === '<' && --depth === 0) {
      open = index;
      break;
    }
    if (depth > 64) throw new CilError('Generic signature nesting limit exceeded');
  }
  // A whole name such as <Module> has no declaring definition before the angle fragment.
  if (open === 0) return {definition: name, arguments: []};
  if (open < 0) throw new CilError('Unbalanced generic type name');
  const argumentsList = [];
  const delimiters = [];
  let start = open + 1;
  for (let index = start; index < name.length - 1; index++) {
    const character = name[index];
    if (character === '<' || character === '[') delimiters.push(character);
    else if (character === '>' || character === ']') {
      if (delimiters.pop() !== (character === '>' ? '<' : '[')) throw new CilError('Unbalanced generic type name');
    } else if (character === ',' && !delimiters.length) {
      argumentsList.push(name.slice(start, index).trim());
      start = index + 1;
    }
    if (delimiters.length > 64) throw new CilError('Generic signature nesting limit exceeded');
  }
  if (delimiters.length) throw new CilError('Unbalanced generic type name');
  argumentsList.push(name.slice(start, -1).trim());
  return {definition: name.slice(0, open), arguments: argumentsList};
}
export function substituteTypeArguments(type, argumentsList = [], methodArguments = []) {
  return type.replace(/!!?\d+/g, variable => variable.startsWith('!!')
    ? methodArguments[Number(variable.slice(2))] ?? variable : argumentsList[Number(variable.slice(1))] ?? variable);
}

const aliases = new Map(Object.entries({
  'System.Void': 'void', 'System.Boolean': 'bool', 'System.Char': 'char', 'System.SByte': 'sbyte',
  'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort', 'System.Int32': 'int',
  'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong', 'System.Single': 'float',
  'System.Double': 'double', 'System.String': 'string', 'System.Object': 'object',
  'System.IntPtr': 'nint', 'System.UIntPtr': 'nuint'
}));

/** Canonical signature spelling; opaque metadata names are left intact. */
export function normalizeCallType(type) {
  const modifier = type.search(/\s+(?:modreq\(|modopt\(|pinned$)/);
  if (modifier >= 0) return normalizeCallType(type.slice(0, modifier)) + type.slice(modifier);
  const suffix = type.match(/(?:\[[\d\s,.*:+-]*\]|[&*])$/);
  if (suffix) return normalizeCallType(type.slice(0, -suffix[0].length)) + suffix[0];
  const parts = genericTypeParts(type);
  if (parts.arguments.length) return parts.definition + '<' + parts.arguments.map(normalizeCallType).join(',') + '>';
  return aliases.get(type) ?? type;
}

/** Substitute CLI VAR/MVAR components, retaining unresolved variables for verification. */
export function substituteCallType(type, typeArguments = [], methodArguments = []) {
  return normalizeCallType(substituteTypeArguments(type, typeArguments, methodArguments));
}

/** The returned signature shares no mutable parameter array with metadata. */
export function instantiateSignature(signature, typeArguments = [], methodArguments = []) {
  return {...signature,
    returnType: substituteCallType(signature.returnType, typeArguments, methodArguments),
    parameters: signature.parameters.map(type => substituteCallType(type, typeArguments, methodArguments))};
}

export function callSignatureKey(signature) {
  return JSON.stringify([!!signature.isStatic, signature.callingConvention ?? 0, signature.genericArity ?? 0,
    normalizeCallType(signature.returnType), signature.parameters.map(normalizeCallType)]);
}

