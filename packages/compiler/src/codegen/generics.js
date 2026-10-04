/**
 * Generic code for the back ends (SF-A02-T02.6).
 *
 * CIL: constructed types and methods are referenced through TypeSpec and MethodSpec rows whose blobs follow
 * ECMA-335 II.23.2.12-15: GENERICINST (CLASS | VALUETYPE) token count args, VAR n for a type parameter of the
 * enclosing type, MVAR n for a method type parameter. A call on a receiver whose type is a type parameter is
 * emitted `constrained. T callvirt`, and a value of type-parameter type is boxed (`box T`) before a reference
 * conversion, which is a no-op for reference types at run time.
 *
 * Bytecode IR: the 30-opcode IR is untyped at run time, so generic code can only run by erasure, and only when no
 * instruction depends on the type argument. `erasurePlan` decides that and names the missing capability otherwise;
 * the emitter refuses instead of miscompiling.
 */
import { SymbolKind, TypeKind, ArrayTypeSymbol, NamedTypeSymbol, PointerTypeSymbol } from '../symbols/types.js';

/** ECMA-335 II.23.1.16 element types used by generic signatures. */
export const ElementType = Object.freeze({
  Void: 0x01,
  Boolean: 0x02,
  Char: 0x03,
  I1: 0x04,
  U1: 0x05,
  I2: 0x06,
  U2: 0x07,
  I4: 0x08,
  U4: 0x09,
  I8: 0x0a,
  U8: 0x0b,
  R4: 0x0c,
  R8: 0x0d,
  String: 0x0e,
  Ptr: 0x0f,
  ValueType: 0x11,
  Class: 0x12,
  Var: 0x13,
  Array: 0x14,
  GenericInst: 0x15,
  IntPtr: 0x18,
  UIntPtr: 0x19,
  Object: 0x1c,
  SZArray: 0x1d,
  MVar: 0x1e,
});

const primitiveElementTypes = Object.freeze({
  System_Void: ElementType.Void,
  System_Boolean: ElementType.Boolean,
  System_Char: ElementType.Char,
  System_SByte: ElementType.I1,
  System_Byte: ElementType.U1,
  System_Int16: ElementType.I2,
  System_UInt16: ElementType.U2,
  System_Int32: ElementType.I4,
  System_UInt32: ElementType.U4,
  System_Int64: ElementType.I8,
  System_UInt64: ElementType.U8,
  System_Single: ElementType.R4,
  System_Double: ElementType.R8,
  System_String: ElementType.String,
  System_IntPtr: ElementType.IntPtr,
  System_UIntPtr: ElementType.UIntPtr,
  System_Object: ElementType.Object,
});

const GENERIC_METHOD_INSTANCE = 0x0a;

/** ECMA-335 II.23.2 compressed unsigned integer. */
export function compressUnsigned(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x1fffffff) throw new RangeError(`Cannot compress ${value}`);
  if (value < 0x80) return [value];
  if (value < 0x4000) return [0x80 | (value >> 8), value & 0xff];
  return [0xc0 | (value >> 24), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** TypeDefOrRefOrSpec coded index (II.23.2.8): table tag in the low two bits. */
export function typeDefOrRefEncoded(token) {
  const table = token >>> 24;
  const row = token & 0xffffff;
  const tag = table === 0x02 ? 0 : table === 0x01 ? 1 : table === 0x1b ? 2 : -1;
  if (tag < 0) throw new RangeError(`Token 0x${token.toString(16)} is not a TypeDef, TypeRef or TypeSpec`);
  return compressUnsigned((row << 2) | tag);
}

/** The ordinal of a type parameter counting those of every enclosing type first, as VAR indexes them. */
export function typeParameterOrdinal(parameter) {
  let ordinal = parameter.ordinal;
  for (let outer = parameter.containingSymbol?.containingType; outer; outer = outer.containingType) {
    ordinal += outer.originalDefinition.typeParameters.length;
  }
  return ordinal;
}

/** The type arguments of a constructed type including those of its enclosing constructed types, outermost first. */
export function allTypeArguments(type) {
  const container = type.containingType;
  const outer = container && !container.isDefinition ? allTypeArguments(container) : [];
  return [...outer, ...type.typeArguments.map(argument => argument.type)];
}

/** The type parameters a definition stands over in its own code: those of its enclosing types, then its own. */
export function allTypeParameters(type) {
  const outer = type.containingType ? allTypeParameters(type.containingType.originalDefinition) : [];
  return [...outer, ...type.typeParameters];
}

/**
 * Encodes a type as a signature blob (without the leading calling convention).
 * @param type a TypeSymbol
 * @param {(definition: NamedTypeSymbol) => number} tokenOf TypeDef or TypeRef token of a type definition
 * @returns {number[]} signature bytes
 */
export function encodeTypeSignature(type, tokenOf) {
  if (type.kind === SymbolKind.TypeParameter) {
    const isMethodParameter = type.typeParameterKind === 'method';
    const ordinal = isMethodParameter ? type.ordinal : typeParameterOrdinal(type);
    return [isMethodParameter ? ElementType.MVar : ElementType.Var, ...compressUnsigned(ordinal)];
  }
  if (type instanceof ArrayTypeSymbol) return encodeArraySignature(type, tokenOf);
  if (type instanceof PointerTypeSymbol) return [ElementType.Ptr, ...encodeTypeSignature(type.pointedAtType, tokenOf)];
  if (!(type instanceof NamedTypeSymbol)) throw new TypeError(`Cannot encode '${type.toDisplayString()}' in a signature`);
  // An anonymous type is written as the construction of the generic class that declares it.
  if (type.isAnonymousType) return encodeTypeSignature(type.metadataForm(), tokenOf);

  const primitive = primitiveElementTypes[type.specialType];
  if (primitive !== undefined && !type.typeArguments.length) return [primitive];

  const definition = type.originalDefinition;
  const classOrValueType = type.isValueType ? ElementType.ValueType : ElementType.Class;
  const reference = [classOrValueType, ...typeDefOrRefEncoded(tokenOf(definition))];
  // A definition named in its own code is the instantiation over its type parameters, enclosing ones included.
  const typeArguments = type.isDefinition ? allTypeParameters(type) : allTypeArguments(type);
  if (!typeArguments.length) return reference;
  const encodedArguments = typeArguments.flatMap(argument => encodeTypeSignature(argument, tokenOf));
  return [ElementType.GenericInst, ...reference, ...compressUnsigned(typeArguments.length), ...encodedArguments];
}

function encodeArraySignature(type, tokenOf) {
  const element = encodeTypeSignature(type.elementType, tokenOf);
  if (type.isSZArray) return [ElementType.SZArray, ...element];
  // ArrayShape: rank, no sizes, and a zero lower bound per dimension.
  const lowerBounds = Array.from({ length: type.rank }, () => 0);
  return [ElementType.Array, ...element, ...compressUnsigned(type.rank), 0, ...compressUnsigned(type.rank), ...lowerBounds];
}

/** The TypeSpec blob of a constructed type, array or type parameter. */
export function typeSpecBlob(type, tokenOf) {
  return Uint8Array.from(encodeTypeSignature(type, tokenOf));
}

/** The MethodSpec instantiation blob (II.23.2.15) of a constructed generic method. */
export function methodSpecBlob(method, tokenOf) {
  const typeArguments = method.typeArguments.map(argument => argument.type);
  if (!typeArguments.length) throw new RangeError(`'${method.name}' is not a constructed generic method`);
  const encodedArguments = typeArguments.flatMap(argument => encodeTypeSignature(argument, tokenOf));
  return Uint8Array.from([GENERIC_METHOD_INSTANCE, ...compressUnsigned(typeArguments.length), ...encodedArguments]);
}

/** True when a type reference needs a TypeSpec row rather than a TypeDef/TypeRef token. */
export function needsTypeSpec(type) {
  if (type.kind === SymbolKind.TypeParameter || type instanceof ArrayTypeSymbol || type instanceof PointerTypeSymbol) return true;
  if (type.isAnonymousType) return needsTypeSpec(type.metadataForm());
  return type instanceof NamedTypeSymbol && !type.isDefinition && allTypeArguments(type).length > 0;
}

/** True when a method reference needs a MethodSpec row. */
export function needsMethodSpec(method) {
  return method.arity > 0 && (method.constructedFrom ?? method) !== method;
}

/**
 * How an instance call is emitted for a receiver of the given static type.
 *   type parameter receiver  -> `constrained. T` + callvirt (works for both reference and value type arguments)
 *   value type receiver      -> call on the address, or constrained callvirt for a virtual method it does not override
 *   reference type receiver  -> callvirt (null check and virtual dispatch), or call for `base.M()`
 */
export function callInstruction(receiverType, method, { isBaseAccess = false } = {}) {
  if (method.isStatic) return { opcode: 'call', constrained: null };
  if (receiverType.kind === SymbolKind.TypeParameter) return { opcode: 'callvirt', constrained: receiverType };
  if (receiverType.isValueType === true) {
    const declaredOnReceiver = method.containingType?.originalDefinition === receiverType.originalDefinition;
    if (declaredOnReceiver) return { opcode: 'call', constrained: null };
    return { opcode: 'callvirt', constrained: receiverType };
  }
  return { opcode: isBaseAccess ? 'call' : 'callvirt', constrained: null };
}

/**
 * Whether a conversion from a type-parameter typed value needs `box T` (identity conversions do not; conversions to
 * object, to a constraint class or interface, and type tests do), and `unbox.any T` for the reverse direction.
 */
export function typeParameterConversion(from, to) {
  const fromParameter = from.kind === SymbolKind.TypeParameter;
  const toParameter = to.kind === SymbolKind.TypeParameter;
  if (fromParameter && toParameter && from === to) return { instructions: [] };
  if (fromParameter) return { instructions: [{ opcode: 'box', type: from }, ...(toParameter ? [{ opcode: 'unbox.any', type: to }] : [])] };
  if (toParameter) return { instructions: [{ opcode: 'unbox.any', type: to }] };
  return { instructions: [] };
}

/**
 * Whether a generic method or type member can run on the untyped bytecode IR by erasing its type parameters.
 * Erasure is sound when the code only moves values of type-parameter type around. It is not when the type argument
 * decides behaviour: `default(T)` (0 vs null), `new T()`, `typeof(T)`, `is T` / `as T` / casts to T, arrays of T
 * (element default), by-reference parameters and constrained calls on T.
 * @param body a semantic bound tree  @returns {{ executable: boolean, needs: string[] }}
 */
export function erasurePlan(method, body) {
  const needs = new Set();
  for (const parameter of method.parameters ?? []) {
    if (parameter.refKind && parameter.refKind !== 'none') needs.add('by-reference parameters (LDLOCA/LDIND style opcodes)');
  }
  visitBoundTree(body, node => {
    const type = node.type;
    const isParameterTyped = type?.kind === SymbolKind.TypeParameter;
    if (node.kind === 'Default' && isParameterTyped) needs.add('default(T) (a runtime type argument)');
    if (node.kind === 'ObjectCreation' && isParameterTyped) needs.add('new T() (a runtime type argument)');
    if (node.kind === 'TypeOf') needs.add('typeof on a type parameter (runtime type handles)');
    if ((node.kind === 'Is' || node.kind === 'As') && (node.testedType ?? node.targetType)?.kind === SymbolKind.TypeParameter) {
      needs.add('type tests against a type parameter (a runtime type argument)');
    }
    if (node.kind === 'ArrayCreation' && type?.elementType?.kind === SymbolKind.TypeParameter) needs.add('arrays of T (typed NEWARR)');
    if (node.kind === 'Call' && node.constrainedTo) needs.add('constrained calls on a type parameter (interface dispatch)');
    if (node.kind === 'Call' && node.isVirtual) needs.add('virtual dispatch (CALLVIRT)');
  });
  if (method.containingType?.typeKind === TypeKind.Struct) needs.add('value-type copy semantics (struct locals and fields)');
  return { executable: needs.size === 0, needs: [...needs] };
}

function visitBoundTree(node, visit, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) visitBoundTree(item, visit, seen);
    return;
  }
  if (typeof node.toDisplayString === 'function') return;
  if (typeof node.kind === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'syntax' || key === 'type' || key === 'binder' || key === 'locals') continue;
    if (value && typeof value === 'object') visitBoundTree(value, visit, seen);
  }
}
