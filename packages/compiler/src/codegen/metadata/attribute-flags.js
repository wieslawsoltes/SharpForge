/**
 * ECMA-335 attribute flags of source symbols (SF-A02-T29): the Flags columns of TypeDef, Field, MethodDef, Param,
 * Property and GenericParam rows, as Roslyn sets them for the same declarations.
 */
import { TypeAttributes, FieldAttributes, MethodAttributes } from '@sharpforge/cil';
import { TypeKind, Accessibility, Variance, RefKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';

const memberAccess = Object.freeze({
  [Accessibility.Private]: 1,
  [Accessibility.ProtectedAndInternal]: 2,
  [Accessibility.Internal]: 3,
  [Accessibility.Protected]: 4,
  [Accessibility.ProtectedOrInternal]: 5,
  [Accessibility.Public]: 6,
});
const nestedVisibility = Object.freeze({
  [Accessibility.Public]: TypeAttributes.NestedPublic,
  [Accessibility.Private]: TypeAttributes.NestedPrivate,
  [Accessibility.Protected]: TypeAttributes.NestedFamily,
  [Accessibility.Internal]: TypeAttributes.NestedAssembly,
  [Accessibility.ProtectedAndInternal]: TypeAttributes.NestedFamANDAssem,
  [Accessibility.ProtectedOrInternal]: TypeAttributes.NestedFamORAssem,
});
const specialNameKinds = new Set([
  MethodKind.PropertyGet,
  MethodKind.PropertySet,
  MethodKind.EventAdd,
  MethodKind.EventRemove,
  MethodKind.UserDefinedOperator,
  MethodKind.Conversion,
]);

export const ParamAttributes = Object.freeze({ In: 1, Out: 2, Optional: 16 });
export const GenericParamAttributes = Object.freeze({
  Covariant: 1,
  Contravariant: 2,
  ReferenceTypeConstraint: 4,
  NotNullableValueTypeConstraint: 8,
  DefaultConstructorConstraint: 16,
});

/** The access bits shared by Field and MethodDef rows; a member without declared accessibility is private. */
export function memberAccessFlags(symbol) {
  return memberAccess[symbol.declaredAccessibility] ?? 1;
}

/** TypeDef.Flags. @param {{hasStaticConstructor: boolean}} facts what the member list says about the type */
export function typeFlags(type, { hasStaticConstructor }) {
  const nested = !!type.containingType;
  let flags = nested ? (nestedVisibility[type.declaredAccessibility] ?? TypeAttributes.NestedPrivate) : 0;
  if (!nested && type.declaredAccessibility === Accessibility.Public) flags = TypeAttributes.Public;
  const kind = type.typeKind;
  if (kind === TypeKind.Enum || kind === TypeKind.Delegate) return flags | TypeAttributes.Sealed;
  if (kind === TypeKind.Interface) flags |= TypeAttributes.Interface | TypeAttributes.Abstract;
  else if (kind === TypeKind.Struct) flags |= TypeAttributes.Sealed | TypeAttributes.SequentialLayout;
  else if (type.isStatic) flags |= TypeAttributes.Abstract | TypeAttributes.Sealed;
  else {
    if (type.isAbstract) flags |= TypeAttributes.Abstract;
    if (type.isSealed) flags |= TypeAttributes.Sealed;
  }
  // The runtime may run the type initializer lazily unless the program wrote a static constructor.
  return hasStaticConstructor ? flags : flags | TypeAttributes.BeforeFieldInit;
}

/** Field.Flags of a declared field (enum members and `value__` are written by the emitter itself). */
export function fieldFlags(field) {
  let flags = memberAccessFlags(field);
  if (field.isConst) return flags | FieldAttributes.Static | FieldAttributes.Literal | FieldAttributes.HasDefault;
  if (field.isStatic) flags |= FieldAttributes.Static;
  if (field.isReadOnly) flags |= FieldAttributes.InitOnly;
  return flags;
}

/**
 * MethodDef.Flags.
 * @param {{implementsInterface: boolean, inInterface: boolean}} facts `implementsInterface`: a non-virtual method an
 *   interface member maps to (the CLR needs it virtual; it is sealed so that C# semantics do not change), or - with
 *   `inInterface` - the explicit implementation of a base interface's member
 */
export function methodFlags(method, { implementsInterface, inInterface }) {
  let flags = memberAccessFlags(method) | MethodAttributes.HideBySig;
  const kind = method.methodKind;
  if (kind === MethodKind.Constructor || kind === MethodKind.StaticConstructor) {
    flags |= MethodAttributes.SpecialName | MethodAttributes.RTSpecialName;
    if (kind === MethodKind.StaticConstructor) flags = (flags & ~MethodAttributes.MemberAccessMask) | MethodAttributes.Private;
  }
  if (specialNameKinds.has(kind)) flags |= MethodAttributes.SpecialName;
  if (method.isStatic || kind === MethodKind.StaticConstructor) {
    flags |= MethodAttributes.Static;
    // C# 11: a static abstract or virtual interface member occupies a slot that the implementing type fills.
    // (An accessor takes the modifiers of its property or event.)
    const declared = method.associatedSymbol ?? method,
      isAbstract = !!(method.isAbstract || declared.isAbstract),
      isVirtual = isAbstract || !!(method.isVirtual || declared.isVirtual);
    if (inInterface && isVirtual) flags |= MethodAttributes.Virtual | (isAbstract ? MethodAttributes.Abstract : 0);
    return flags;
  }
  if (kind === MethodKind.Constructor) return flags;
  const isAbstract = method.isAbstract || (inInterface && !method.hasBody);
  if (isAbstract) flags |= MethodAttributes.Abstract;
  // An interface member that implements a member of a base interface (`string IA.Who() => ...`, or `abstract string
  // IA.Who();` to make it abstract again) takes no slot of its own; the CLR requires it to be final.
  if (inInterface && implementsInterface) return flags | MethodAttributes.Virtual | MethodAttributes.Final;
  if (isAbstract || method.isVirtual || method.isOverride || inInterface || kind === MethodKind.Destructor) flags |= MethodAttributes.Virtual;
  else if (implementsInterface) flags |= MethodAttributes.Virtual | MethodAttributes.Final | MethodAttributes.NewSlot;
  if ((flags & MethodAttributes.Virtual) && !method.isOverride && kind !== MethodKind.Destructor) flags |= MethodAttributes.NewSlot;
  if (method.isOverride && method.isSealed) flags |= MethodAttributes.Final;
  return flags;
}

/** Param.Flags: `out` and `in` are marked; an optional parameter is marked without its default constant. */
export function parameterFlags(parameter) {
  let flags = 0;
  if (parameter.refKind === RefKind.Out) flags |= ParamAttributes.Out;
  if (parameter.refKind === RefKind.In) flags |= ParamAttributes.In;
  if (parameter.isOptional) flags |= ParamAttributes.Optional;
  return flags;
}

/** GenericParamAttributes.AllowByRefLike (.NET 9 metadata): the type parameter takes ref struct arguments. */
const ALLOW_BY_REF_LIKE = 0x0020;

/** GenericParam.Flags: variance and the special constraints. */
export function genericParameterFlags(parameter) {
  let flags = 0;
  if (parameter.variance === Variance.Out) flags |= GenericParamAttributes.Covariant;
  if (parameter.variance === Variance.In) flags |= GenericParamAttributes.Contravariant;
  if (parameter.hasReferenceTypeConstraint) flags |= GenericParamAttributes.ReferenceTypeConstraint;
  if (parameter.hasValueTypeConstraint || parameter.hasUnmanagedTypeConstraint) {
    flags |= GenericParamAttributes.NotNullableValueTypeConstraint | GenericParamAttributes.DefaultConstructorConstraint;
  }
  if (parameter.hasConstructorConstraint) flags |= GenericParamAttributes.DefaultConstructorConstraint;
  // C# 13 `allows ref struct` (ECMA-335 augments: AllowByRefLike); without it the runtime rejects a ref struct argument.
  if (parameter.allowsRefLikeType) flags |= ALLOW_BY_REF_LIKE;
  return flags;
}
