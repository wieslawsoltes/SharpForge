/**
 * Type substitution and constructed symbols (SF-A02-T02.2).
 *
 * The symbol classes construct lazily (`NamedTypeSymbol.construct`, `MethodSymbol.construct`, `asMemberOf`); this
 * module is the vocabulary the binder uses on top of them: the substitution of a (possibly nested) constructed type,
 * base-type and interface walks that keep type arguments (`Derived<int>` sees `Base<int>`'s members typed with int),
 * member lookup through the hierarchy with members retargeted to the constructed container, and the effective base
 * class / interface set of a type parameter.
 */
import {
  TypeMap,
  TypeKind,
  SymbolKind,
  NamedTypeSymbol,
  ConstructedNamedTypeSymbol,
  TypeParameterSymbol,
  ArrayTypeSymbol,
  TypeWithAnnotations,
  typeOf,
} from './types.js';

/** The substitution a constructed type applies to its definition's members (enclosing types included). */
export function typeMapOf(type) {
  return type instanceof ConstructedNamedTypeSymbol ? type.typeMap : TypeMap.empty;
}
/** Substitutes type parameters in `type` (a TypeSymbol or TypeWithAnnotations) and returns a bare TypeSymbol. */
export function substitute(type, map) {
  return map.isEmpty ? typeOf(type) : typeOf(map.substituteType(type));
}
/** Constructs `definition` with `typeArguments`; a nested type is constructed inside its (constructed) container. */
export function constructType(definition, typeArguments, container = null) {
  const args = typeArguments.map(a => (a instanceof TypeWithAnnotations ? a : new TypeWithAnnotations(a)));
  if (container && container instanceof ConstructedNamedTypeSymbol)
    return new ConstructedNamedTypeSymbol(definition.originalDefinition, args, container);
  return definition.arity ? definition.construct(args) : definition;
}
/** A nested type seen through a constructed container: `Outer<int>.Inner` (its own parameters still open). */
export function nestedTypeOf(container, nested) {
  if (!(container instanceof ConstructedNamedTypeSymbol)) return nested;
  return new ConstructedNamedTypeSymbol(nested.originalDefinition, nested.originalDefinition.typeArguments, container);
}
/**
 * The type nested in `container` (or in one of its base classes) that `name` with these type arguments names,
 * seen through the container: `Outer<string>.Cache<int>`. @returns the type, or null when there is no such nested type
 */
export function memberTypeOf(container, name, typeArguments = []) {
  for (let type = container; type; type = type.baseType) {
    const nested = (type.originalDefinition ?? type).getTypeMembers?.(name, typeArguments.length)[0];
    if (!nested) continue;
    return typeArguments.length ? constructType(nested, typeArguments, type) : nestedTypeOf(type, nested);
  }
  return null;
}
/** The type parameters in scope of a type: its own and those of every enclosing type, outermost first. */
export function allTypeParameters(type) {
  const chain = [];
  for (let t = type?.originalDefinition; t; t = t.containingType) chain.unshift(t);
  return chain.flatMap(t => [...t.typeParameters]);
}
/** The effective base class of a type parameter: its class constraint, ValueType for `struct`, else object. */
export function effectiveBaseClass(parameter, core) {
  const isValueConstrained = parameter.hasValueTypeConstraint || parameter.hasUnmanagedTypeConstraint;
  for (const c of parameter.constraintTypes) {
    const t = typeOf(c);
    // `where T : struct, Enum` (C# 7.3): the class constraint is the base class also of a value-constrained parameter.
    if (t.typeKind === TypeKind.Class) return t;
    if (isValueConstrained) continue;
    if (t.typeKind === TypeKind.TypeParameter) {
      const b = effectiveBaseClass(t, core);
      if (b !== core.object) return b;
    }
    if (t.typeKind === TypeKind.Struct || t.typeKind === TypeKind.Enum) return t;
  }
  return isValueConstrained ? core.valueType : core.object;
}
/** The effective interface set of a type parameter: constraint interfaces and those of constraint types. */
export function effectiveInterfaces(parameter, seen = new Set()) {
  const result = [];
  if (seen.has(parameter)) return result;
  seen.add(parameter);
  const add = i => {
    if (!result.some(x => x.equals(i))) result.push(i);
  };
  for (const c of parameter.constraintTypes) {
    const t = typeOf(c);
    if (t.typeKind === TypeKind.Interface) {
      add(t);
      t.allInterfaces.forEach(add);
    } else if (t.typeKind === TypeKind.TypeParameter) effectiveInterfaces(t, seen).forEach(add);
    else t.allInterfaces.forEach(add);
  }
  return result;
}
/** The base class of any type: class base, System.Array for arrays, the effective base class for type parameters. */
export function baseTypeOf(type, core) {
  if (type instanceof TypeParameterSymbol) return effectiveBaseClass(type, core);
  if (type instanceof ArrayTypeSymbol) return type.baseType ?? core.array;
  if (type.typeKind === TypeKind.Interface) return null;
  return type.baseType ?? null;
}
/** `type` and its base classes, most derived first (cycles are cut). */
export function baseTypeChain(type, core) {
  const result = [],
    seen = new Set();
  for (let t = type; t && !seen.has(t.originalDefinition ?? t); t = baseTypeOf(t, core)) {
    seen.add(t.originalDefinition ?? t);
    result.push(t);
  }
  return result;
}
/** Every interface a type implements or (for an interface) inherits, with type arguments substituted. */
export function allInterfacesOf(type, core) {
  if (type instanceof TypeParameterSymbol) return effectiveInterfaces(type);
  const result = [],
    seen = new Set(),
    add = t => {
      for (const i of t.interfaces ?? []) {
        if (i.isErrorType?.() || result.some(x => x.equals(i))) continue;
        result.push(i);
        add(i);
      }
    };
  for (const t of type.typeKind === TypeKind.Interface ? [type] : baseTypeChain(type, core)) {
    if (seen.has(t)) break;
    seen.add(t);
    add(t);
  }
  return result;
}
/**
 * Members named `name` visible on `type` through inheritance, most derived first, each retargeted to the constructed
 * type that declares it. Interfaces contribute their base interfaces; type parameters their constraints; every
 * interface and type parameter also sees System.Object's members. Hidden members are not filtered here (lookup does).
 */
export function membersInHierarchy(type, name, core) {
  const result = [];
  if (type instanceof TypeParameterSymbol) {
    for (const t of [effectiveBaseClass(type, core), ...effectiveInterfaces(type)])
      for (const m of membersInHierarchy(t, name, core)) if (!result.includes(m)) result.push(m);
    return result;
  }
  if (type.typeKind === TypeKind.Interface) {
    for (const t of [type, ...allInterfacesOf(type, core)]) result.push(...t.getMembers(name));
    result.push(...core.object.getMembers(name));
    return result;
  }
  for (const t of baseTypeChain(type, core)) result.push(...t.getMembers(name));
  return result;
}
/** True when `type` is `baseType` or derives from it (classes), comparing constructed types structurally. */
export function derivesFrom(type, baseType, core) {
  for (const t of baseTypeChain(type, core)) if (t.equals(baseType)) return true;
  return false;
}
/** True when `type` implements (or is, or inherits) the interface `iface`. */
export function implementsInterface(type, iface, core) {
  return type.equals(iface) || allInterfacesOf(type, core).some(i => i.equals(iface));
}
/** The construction of `definition` found among `type`'s base classes and interfaces (IEnumerable<T> of a List<int> is IEnumerable<int>), or null. */
export function findConstruction(type, definition, core) {
  for (const t of [...baseTypeChain(type, core), ...allInterfacesOf(type, core)])
    if (t instanceof NamedTypeSymbol && t.originalDefinition === definition.originalDefinition) return t;
  return null;
}
/** A member of a generic definition viewed through a constructed type. */
export function retarget(member, type) {
  return type instanceof ConstructedNamedTypeSymbol && member.asMemberOf && member.containingSymbol === type.originalDefinition
    ? member.asMemberOf(type)
    : member;
}
/** True when a type mentions any type parameter (is open). */
export function containsTypeParameter(type, parameters = null) {
  type = typeOf(type);
  if (!type) return false;
  if (type.kind === SymbolKind.TypeParameter) return !parameters || parameters.includes(type);
  if (type instanceof ArrayTypeSymbol) return containsTypeParameter(type.elementType, parameters);
  if (type instanceof NamedTypeSymbol)
    return (
      type.typeArguments.some(a => a.type !== type && containsTypeParameter(a, parameters)) ||
      (!!type.containingType &&
        type.containingType !== type &&
        !type.containingType.isDefinition &&
        containsTypeParameter(type.containingType, parameters))
    );
  return false;
}
