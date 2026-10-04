/**
 * Signature blobs of declared members (SF-A02-T29), ECMA-335 II.23.2: FieldSig, MethodDefSig and PropertySig built
 * from symbols. Types are encoded by `TypeTokens.signature`; a by-reference parameter or return is `BYREF type`.
 */
import { RefKind } from '../../symbols/types.js';
import { compressUnsigned, ElementType, typeDefOrRefEncoded } from '../generics.js';
import { inheritedSignatureModifiers } from './inherited-modifiers.js';

const FIELD = 0x06;
const PROPERTY = 0x08;
const HAS_THIS = 0x20;
const GENERIC = 0x10;
const BY_REFERENCE = 0x10;
const CMOD_REQUIRED = 0x1f;
const CMOD_OPTIONAL = 0x20;
const IS_EXTERNAL_INIT = 'System.Runtime.CompilerServices.IsExternalInit';

const isByReference = refKind => !!refKind && refKind !== RefKind.None;

/** The signature of a symbol type, or of a framework class named by its full metadata name. */
function typeBytes(types, type) {
  return typeof type === 'string' ? types.frameworkClassSignature(type) : types.signature(type);
}

/** `modreq(T)` / `modopt(T)` entries (ECMA-335 II.23.2.7) for modifiers `{isOptional, type}` read from metadata. */
function customModifiers(types, modifiers) {
  return (modifiers ?? []).flatMap(modifier => [
    modifier.isOptional ? CMOD_OPTIONAL : CMOD_REQUIRED,
    ...typeDefOrRefEncoded(types.definitionToken(modifier.type)),
  ]);
}

/**
 * One parameter or return slot: `CustomMod* [BYREF] CustomMod* Type`.
 * @param modifiers the slot's imported custom modifiers `{outer, inner}`, or null (see metadata-import/signature-modifiers.js)
 */
function passed(types, type, refKind, modifiers = null) {
  const outer = customModifiers(types, modifiers?.outer),
    inner = customModifiers(types, modifiers?.inner);
  return isByReference(refKind) ? [...outer, BY_REFERENCE, ...inner, ...typeBytes(types, type)] : [...outer, ...typeBytes(types, type)];
}

/** `modreq(T)` before a type (ECMA-335 II.23.2.7); `modifier` is the full metadata name of a framework class, or null. */
function requiredModifier(types, modifier) {
  return modifier ? [CMOD_REQUIRED, ...typeDefOrRefEncoded(types.builder.typeRef(modifier))] : [];
}

function returned(types, type, refKind, modifier = null, modifiers = null) {
  // An imported method carries its modifiers itself (an `init` accessor's `IsExternalInit` among them).
  const named = modifiers ? [] : requiredModifier(types, modifier);
  if (type.specialType === 'System_Void') return [...named, ...customModifiers(types, modifiers?.outer), ElementType.Void];
  return [...named, ...passed(types, type, refKind, modifiers)];
}

/** FieldSig: `FIELD [BYREF] type`; a `ref` field (C# 11) of a ref struct holds a managed pointer. */
export function fieldSignature(types, type, refKind = null) {
  return Uint8Array.from([FIELD, ...(isByReference(refKind) ? [BY_REFERENCE] : []), ...types.signature(type)]);
}

/**
 * MethodDefSig: calling convention, generic arity, parameter count, return type, parameters.
 * @param {{isStatic: boolean, arity?: number, returnType: object|string, refKind?: string, returnModifier?: string,
 *   parameters: object[]}} shape `parameters` are `{type, refKind}`; a type is a type symbol, or the full metadata name
 *   of a framework class; `returnModifier` is the full name of a required modifier of the return type
 */
export function methodSignature(types, shape) {
  const arity = shape.arity ?? 0,
    convention = (shape.isStatic ? 0 : HAS_THIS) | (arity ? GENERIC : 0);
  return Uint8Array.from([
    convention,
    ...(arity ? compressUnsigned(arity) : []),
    ...compressUnsigned(shape.parameters.length),
    ...returned(types, shape.returnType, shape.refKind, shape.returnModifier, shape.returnCustomModifiers),
    ...shape.parameters.flatMap(parameter => passed(types, parameter.type, parameter.refKind, parameter.customModifiers)),
  ]);
}

/** The MethodDefSig of a method symbol. */
export function methodSymbolSignature(types, method) {
  // A source method repeats the custom modifiers of the imported member it overrides or implements.
  const inherited = method.returnCustomModifiers ? null : inheritedSignatureModifiers(method),
    parameters = inherited
      ? method.parameters.map((parameter, index) => ({ type: parameter.type, refKind: parameter.refKind, customModifiers: inherited.parameters[index] }))
      : method.parameters;
  return methodSignature(types, {
    isStatic: method.isStatic,
    arity: method.typeParameters?.length ?? 0,
    returnType: method.returnType,
    refKind: method.refKind,
    // An `init` accessor is a setter only compilers that know the feature may call.
    returnModifier: method.isInitOnly ? IS_EXTERNAL_INIT : null,
    returnCustomModifiers: method.returnCustomModifiers ?? inherited?.returned ?? null,
    parameters,
  });
}

/** PropertySig: `PROPERTY [HASTHIS] count type parameters` (the parameters are those of an indexer). */
export function propertySignature(types, property) {
  return Uint8Array.from([
    PROPERTY | (property.isStatic ? 0 : HAS_THIS),
    ...compressUnsigned(property.parameters.length),
    ...passed(types, property.type, property.refKind),
    ...property.parameters.flatMap(parameter => passed(types, parameter.type, parameter.refKind)),
  ]);
}
