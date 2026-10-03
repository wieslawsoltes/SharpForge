/**
 * Identity and names of closed generic constructions (SF-A02-T02.6).
 *
 * `typeKey` is the identity of a closed type: two symbols with the same key are the same construction, however the
 * binder built them. `instantiationTypeName` and `instantiationMethodName` are the names the image shows for a
 * monomorphized class or method.
 *
 * The names are safe for every consumer of image type names: the runtime's type-name parser reads `<...>` as a
 * framework generic, `,` as an argument separator, `[...]` as an array shape and `?`, `*`, `&` and a backtick as type
 * suffixes, so none of those characters (nor parentheses or spaces) is used. Type arguments are written in braces and
 * separated by semicolons: `Pair{int;Box{string}}`, `Program.Identity{int}`. Arrays and nullable types inside an
 * argument are spelled out (`Array{int}`, `Nullable{int}`).
 */
import { ArrayTypeSymbol, NamedTypeSymbol, TypeKind, typeOf } from '../../symbols/types.js';

const keywordNames = Object.freeze({
  System_Object: 'object',
  System_String: 'string',
  System_Boolean: 'bool',
  System_Char: 'char',
  System_SByte: 'sbyte',
  System_Byte: 'byte',
  System_Int16: 'short',
  System_UInt16: 'ushort',
  System_Int32: 'int',
  System_UInt32: 'uint',
  System_Int64: 'long',
  System_UInt64: 'ulong',
  System_Single: 'float',
  System_Double: 'double',
  System_Decimal: 'decimal',
  System_Void: 'void',
});

/** Assigns each definition symbol a small number, so that keys do not depend on display names. */
export class DefinitionIds {
  constructor() {
    this.ids = new Map();
  }
  of(definition) {
    let id = this.ids.get(definition);
    if (id === undefined) {
      id = this.ids.size + 1;
      this.ids.set(definition, id);
    }
    return id;
  }
}

/** The structural key of a closed type. `ids` is the `DefinitionIds` of the program being generated. */
export function typeKey(type, ids) {
  type = typeOf(type);
  if (type instanceof ArrayTypeSymbol) return `[${type.rank}]${typeKey(type.elementType, ids)}`;
  if (!(type instanceof NamedTypeSymbol)) return `?${ids.of(type)}`;
  const definition = type.originalDefinition,
    container = type.containingType,
    outer = container ? typeKey(container, ids) + '+' : '',
    args = definition.arity ? '{' + type.typeArguments.map(argument => typeKey(argument, ids)).join(';') + '}' : '';
  return `${outer}#${ids.of(definition)}${args}`;
}

/** The namespace-qualified name of a type definition without type arguments (`Zoo.Box`). */
function qualifiedName(definition) {
  const parts = [definition.name];
  for (let space = definition.containingNamespace; space && !space.isGlobalNamespace; space = space.containingNamespace) parts.unshift(space.name);
  return parts.join('.');
}

/** The spelling of a closed type inside a synthesized name. */
export function typeNameText(type) {
  type = typeOf(type);
  if (type instanceof ArrayTypeSymbol) return `Array${type.rank > 1 ? type.rank : ''}{${typeNameText(type.elementType)}}`;
  if (!(type instanceof NamedTypeSymbol)) return sanitize(type.name ?? 'T');
  const keyword = keywordNames[type.specialType];
  if (keyword) return keyword;
  const definition = type.originalDefinition,
    container = type.containingType,
    prefix = container ? typeNameText(container) + '.' + definition.name : qualifiedName(definition);
  if (!definition.arity) return sanitize(prefix);
  if (definition.specialType === 'System_Nullable_T') return `Nullable{${typeNameText(type.typeArguments[0])}}`;
  return `${sanitize(prefix)}{${type.typeArguments.map(typeNameText).join(';')}}`;
}

/** Removes every character a type-name parser gives a meaning to. */
function sanitize(text) {
  return String(text).replace(/[<>,()[\]?*&`\s]/g, '_');
}

/**
 * An image type name as it appears inside a synthesized class name. A registry generic is written with the
 * characters a type-name parser reads (``List`1<string>``); inside another name it is spelled like a construction:
 * `System.Collections.Generic.List{string}`.
 */
export function imageTypeNameText(name) {
  if (!name.includes('`')) return name;
  return name.replace(/`\d+/g, '').replace(/</g, '{').replace(/>/g, '}').replace(/,\s*/g, ';');
}

/** The image class name of a closed construction of a source generic class. */
export function instantiationTypeName(type) {
  return typeNameText(type);
}

/** The image method name of a generic method constructed with closed `typeArguments` (`Swap{int}`). */
export function instantiationMethodName(name, typeArguments) {
  return `${name}{${typeArguments.map(typeNameText).join(';')}}`;
}

/** The nesting depth of type arguments: `Box<Box<int>>` is 2. Used to stop instantiation that never terminates. */
export function typeDepth(type) {
  type = typeOf(type);
  if (type instanceof ArrayTypeSymbol) return 1 + typeDepth(type.elementType);
  if (!(type instanceof NamedTypeSymbol) || type.typeKind === TypeKind.TypeParameter) return 0;
  let depth = 0;
  for (const argument of type.typeArguments) depth = Math.max(depth, typeDepth(argument));
  const own = type.originalDefinition.arity ? 1 + depth : 0;
  return Math.max(own, type.containingType ? typeDepth(type.containingType) : 0);
}
