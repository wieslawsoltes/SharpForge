/**
 * Class inheritance and base member lookup (SF-A02-T03.1).
 *
 * `resolveBases` binds a type's base list: the base class (object, ValueType, Enum or MulticastDelegate when none is
 * written), the interface list and an enum's underlying type, detecting circular bases (CS0146, CS0529) and reporting
 * CS0509 (sealed base), CS0644 (special class), CS0709 (static base), CS0713/CS0714 (static class with bases),
 * CS1722 (class after interfaces), CS0527 (non-interface in the list), CS0528 (duplicate interface), CS1008 (enum
 * underlying type) and CS0060/CS0061 (base less accessible than the type).
 * `checkHiding` compares each member with the inherited members of the same name: CS0108 (hides, `new` missing),
 * CS0114 (hides a virtual member, `override` or `new` missing) and CS0109 (`new` hides nothing).
 * `lookupMembers` is member lookup with hiding applied: the members a simple name or `e.Name` denotes.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { isDynamicType, containsDynamic } from '../symbols/dynamic-types.js';
import { TypeKind, SymbolKind, Accessibility, SymbolDisplayFormat } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { baseTypeChain, allInterfacesOf, membersInHierarchy } from '../symbols/substitution.js';
import { isAccessible } from './accessibility.js';

const order = [
  Accessibility.Private,
  Accessibility.ProtectedAndInternal,
  Accessibility.Protected,
  Accessibility.Internal,
  Accessibility.ProtectedOrInternal,
  Accessibility.Public,
];
/** The accessibility domain rank of a type: the least accessible of the type and its containers. */
export function effectiveAccessibility(type) {
  let rank = order.length - 1;
  for (let t = type.originalDefinition ?? type; t && t.kind === SymbolKind.NamedType; t = t.containingType) {
    rank = Math.min(rank, order.indexOf(t.declaredAccessibility));
  }
  if (type.typeArguments)
    for (const a of type.typeArguments)
      if (a.type !== type && a.type.kind === SymbolKind.NamedType) rank = Math.min(rank, effectiveAccessibility(a.type));
  return rank;
}
/** True when `used` is at least as accessible as `declaring` (CS0050-CS0061 family). */
export function isAtLeastAsAccessible(used, declaringRank) {
  if (!used || used.kind === SymbolKind.TypeParameter || used.kind === SymbolKind.ErrorType) return true;
  if (used.elementType) return isAtLeastAsAccessible(used.elementType, declaringRank);
  if (used.kind !== SymbolKind.NamedType) return true;
  return effectiveAccessibility(used) >= declaringRank;
}
const integralEnumBases = new Set([
  'System_SByte',
  'System_Byte',
  'System_Int16',
  'System_UInt16',
  'System_Int32',
  'System_UInt32',
  'System_Int64',
  'System_UInt64',
]);

/**
 * Binds the base list of a source type.
 * @returns {{baseType,interfaces:TypeSymbol[],enumUnderlyingType?:TypeSymbol}}
 */
export function resolveBases(type, { typeBinder, core, report }) {
  const kind = type.typeKind,
    interfaces = [];
  let baseType = null,
    enumUnderlyingType = null;
  type.interfaceSyntax = new Map();
  const implicitBase =
    kind === TypeKind.Class
      ? type.specialType === 'System_Object'
        ? null
        : core.object
      : kind === TypeKind.Struct
        ? core.valueType
        : kind === TypeKind.Enum
          ? core.enumType
          : kind === TypeKind.Delegate
            ? core.multicastDelegate
            : null;
  for (const declaration of type.declarations) {
    const list = declaration.syntax.baseList?.types ?? [],
      uri = declaration.uri,
      scope = declaration.scope.child('type', { type }),
      rep = (node, code, args) => report(uri, node, code, args);
    list.forEach((entry, index) => {
      const annotated = typeBinder.bindType(entry.type, scope),
        bound = annotated.type;
      if (!bound || bound.isErrorType()) return;
      if (kind === TypeKind.Enum) {
        if (!integralEnumBases.has(bound.specialType)) rep(entry.type, DiagnosticId.CS1008);
        else enumUnderlyingType = bound;
        return;
      }
      // `dynamic` is `object` in metadata: it cannot be a base, and an interface cannot be implemented over it.
      if (isDynamicType(bound)) {
        rep(entry.type, DiagnosticId.CS1965, [type.toDisplayString()]);
        return;
      }
      if (bound.typeKind === TypeKind.Interface && containsDynamic(bound)) {
        rep(entry.type, DiagnosticId.CS1966, [type.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      if (bound.typeKind === TypeKind.Interface) {
        if (interfaces.some(i => i.equals(bound))) {
          if (type.declarations.length === 1 || type.interfaceSyntax.get(interfaces.find(i => i.equals(bound)))?.uri === uri)
            rep(entry.type, DiagnosticId.CS0528, [bound.toDisplayString()]);
          return;
        }
        interfaces.push(bound);
        type.interfaceSyntax.set(bound, { syntax: entry.type, uri, typeWithAnnotations: annotated });
        return;
      }
      if (kind !== TypeKind.Class) {
        rep(entry.type, DiagnosticId.CS0527, [bound.toDisplayString()]);
        return;
      }
      if (bound.typeKind === TypeKind.TypeParameter) {
        rep(entry.type, DiagnosticId.CS0689, [bound.name]);
        return;
      }
      if (index !== 0 && !baseType) {
        rep(entry.type, DiagnosticId.CS1722);
      }
      if (baseType) {
        if (!baseType.equals(bound))
          if (type.declarations.length > 1 && index === 0)
            report(type.declarations[0].uri, type.declarations[0].syntax.identifier, DiagnosticId.CS0263, [type.toDisplayString()]);
          else rep(entry.type, DiagnosticId.CS1721, [type.toDisplayString(), baseType.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      if (type.isStatic && bound.specialType !== 'System_Object') {
        rep(entry.type, DiagnosticId.CS0713, [type.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      if (bound.typeKind !== TypeKind.Class) {
        rep(entry.type, DiagnosticId.CS0509, [type.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      if (bound.isStatic) {
        rep(declaration.syntax.identifier, DiagnosticId.CS0709, [type.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      if (bound.isSealed) {
        rep(entry.type, DiagnosticId.CS0509, [type.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      if (['System_Enum', 'System_ValueType', 'System_Delegate', 'System_MulticastDelegate', 'System_Array'].includes(bound.specialType)) {
        rep(entry.type, DiagnosticId.CS0644, [type.toDisplayString(), bound.toDisplayString()]);
        return;
      }
      baseType = bound;
      type.baseSyntax = { syntax: entry.type, uri, typeWithAnnotations: annotated };
    });
    if (type.isStatic && interfaces.length && list.length)
      rep(list.find(e => e.type)?.type ?? declaration.syntax.identifier, DiagnosticId.CS0714, [type.toDisplayString()]);
  }
  const at = type.locations[0],
    repAt = (code, args) => report(at.uri, at, code, args);
  // Circular base class: walk the declared chain; a chain that returns to this type is a cycle.
  if (baseType) {
    const seen = new Set([type]);
    let cyclic = false;
    for (let t = baseType.originalDefinition; t;) {
      if (t === type) {
        cyclic = true;
        break;
      }
      if (seen.has(t)) break;
      seen.add(t);
      const next = t.isSource ? (t._baseState === 2 ? (t.cycleBase ?? t._declaredBase) : declaredBaseQuiet(t, typeBinder)) : t.baseType;
      t = next?.originalDefinition ?? null;
    }
    // A type nested in its own base is a cycle as well.
    for (let c = baseType.originalDefinition.containingType; c && !cyclic; c = c.containingType) if (c === type) cyclic = true;
    if (cyclic) {
      repAt(DiagnosticId.CS0146, [baseType.toDisplayString(), type.toDisplayString()]);
      type.cycleBase = baseType;
      baseType = null;
      type.hasCircularBase = true;
    }
  }
  if (kind === TypeKind.Interface) {
    const cyclic = interfaces.filter(i => {
      const seen = new Set(),
        walk = t => {
          if (t.originalDefinition === type) return true;
          if (seen.has(t.originalDefinition)) return false;
          seen.add(t.originalDefinition);
          const list =
            t.originalDefinition.isSource && t.originalDefinition._baseState !== 2
              ? declaredInterfacesQuiet(t.originalDefinition, typeBinder)
              : t.interfaces;
          return list.some(walk);
        };
      return walk(i);
    });
    for (const i of cyclic) {
      repAt(DiagnosticId.CS0529, [type.toDisplayString(), i.toDisplayString()]);
      interfaces.splice(interfaces.indexOf(i), 1);
    }
  }
  // Inconsistent accessibility of the base class and base interfaces.
  const rank = effectiveAccessibility(type);
  if (baseType && baseType.isSource !== undefined && !isAtLeastAsAccessible(baseType, rank))
    repAt(DiagnosticId.CS0060, [type.toDisplayString(), baseType.toDisplayString()]);
  if (kind === TypeKind.Interface)
    for (const i of interfaces) if (!isAtLeastAsAccessible(i, rank)) repAt(DiagnosticId.CS0061, [type.toDisplayString(), i.toDisplayString()]);
  return { baseType: baseType ?? implicitBase, interfaces, enumUnderlyingType };
}
/** The syntactically declared base class of a source type that is still being resolved (no diagnostics, no recursion). */
function declaredBaseQuiet(type, typeBinder) {
  for (const d of type.declarations) {
    const first = d.syntax.baseList?.types[0];
    if (!first) continue;
    const t = typeBinder.bindType(first.type, d.scope.child('type', { type }), { quiet: true, basesBeingResolved: new Set([type]) }).type;
    if (t && t.typeKind === TypeKind.Class) return t;
  }
  return null;
}
function declaredInterfacesQuiet(type, typeBinder) {
  const out = [];
  for (const d of type.declarations)
    for (const e of d.syntax.baseList?.types ?? []) {
      const t = typeBinder.bindType(e.type, d.scope.child('type', { type }), { quiet: true, basesBeingResolved: new Set([type]) }).type;
      if (t && t.typeKind === TypeKind.Interface) out.push(t);
    }
  return out;
}
const isHidingCandidate = m =>
  !(
    m.kind === SymbolKind.Method &&
    (m.isConstructor ||
      m.methodKind === MethodKind.Destructor ||
      m.isAccessor ||
      m.methodKind === MethodKind.UserDefinedOperator ||
      m.methodKind === MethodKind.Conversion)
  ) &&
  !m.explicitInterfaceSyntax &&
  !m.isImplicitlyDeclared;
/** Parameter-type signature of a method or indexer for hiding/override matching (type parameters compared by position). */
export function sameParameters(a, b, conversions = null) {
  const pa = a.parameters ?? [],
    pb = b.parameters ?? [];
  if (pa.length !== pb.length || (a.arity ?? 0) !== (b.arity ?? 0)) return false;
  const positional = (m, t) => {
    const i = (m.typeParameters ?? []).indexOf(t);
    return i >= 0 ? '!!' + i : null;
  };
  return pa.every((p, i) => {
    const q = pb[i];
    if ((p.refKind === 'none') !== (q.refKind === 'none')) return false;
    const x = positional(a, p.type),
      y = positional(b, q.type);
    if (x || y) return x === y;
    return typeText(a, p.type) === typeText(b, q.type);
  });
}
/** The text of a type in the signature of `m`, its method type parameters written by position (`!!0`). */
export const signatureTypeText = (m, t) => typeText(m, t);
const typeText = (m, t) => {
  // `dynamic` is `object` in a signature, and nullable annotations of reference types are not part of one.
  let text = t.toDisplayString(SymbolDisplayFormat.Signature).replace(/\bdynamic\b/g, 'object');
  (m.typeParameters ?? []).forEach((p, i) => {
    text = text.replace(new RegExp('\\b' + p.name + '\\b', 'g'), '!!' + i);
  });
  return text;
};
/**
 * The inherited members a member hides: accessible members of base classes (and, for interfaces, base interfaces)
 * with the same name - any non-method member, or a method with the same signature. Nearest base first.
 */
export function hiddenMembers(member, type, core) {
  const result = [],
    bases = type.typeKind === TypeKind.Interface ? allInterfacesOf(type, core) : baseTypeChain(type, core).slice(1),
    name = member.kind === SymbolKind.NamedType ? member.name : member.name;
  for (const b of bases) {
    const candidates = [...b.getMembers(name), ...(b.getTypeMembers?.(name) ?? [])].filter(
      c =>
        isAccessible(c.originalDefinition ?? c, type.originalDefinition) &&
        !(c.kind === SymbolKind.Method && (c.isConstructor || c.isAccessor)),
    );
    const hits = candidates.filter(c =>
      member.kind === SymbolKind.Method && c.kind === SymbolKind.Method
        ? sameParameters(member, c)
        : member.kind === SymbolKind.Property && member.isIndexer
          ? c.kind === SymbolKind.Property && c.isIndexer && sameParameters(member, c)
          : true,
    );
    if (hits.length) {
      result.push(...hits);
      break;
    }
  }
  return result;
}
/** Hiding diagnostics for every member (and nested type) of a source type. @returns [{code,args,member}] */
export function checkHiding(type, core) {
  const results = [];
  if (type.typeKind === TypeKind.Enum || type.typeKind === TypeKind.Delegate) return results;
  for (const member of [...type.getMembers(), ...type.getTypeMembers()]) {
    if (member.kind !== SymbolKind.NamedType && !isHidingCandidate(member)) continue;
    const words =
      member.modifierWords ??
      (member.syntax?.modifiers ?? member.declarationSyntax?.modifiers ?? member.syntax?.parent?.parent?.modifiers ?? []).map?.(
        t => t.text,
      ) ??
      [];
    const isNew = member.kind === SymbolKind.NamedType ? words.includes('new') : member.isNew || fieldIsNew(member),
      isOverride = member.isOverride;
    if (isOverride) continue;
    const hidden = hiddenMembers(member, type, core);
    if (!hidden.length) {
      if (isNew) results.push({ code: DiagnosticId.CS0109, args: [member.toDisplayString()], member });
      continue;
    }
    if (isNew) continue;
    const h = hidden[0],
      virtualLike =
        (h.isVirtual || h.isAbstract || h.isOverride) &&
        h.kind === member.kind &&
        h.kind !== SymbolKind.Field &&
        type.typeKind !== TypeKind.Interface;
    results.push({ code: virtualLike ? DiagnosticId.CS0114 : DiagnosticId.CS0108, args: [member.toDisplayString(), h.toDisplayString()], member, hidden: h });
  }
  return results;
}
const fieldIsNew = m => !!(m.declarationSyntax?.modifiers ?? []).some?.(t => t.text === 'new');
/**
 * Member lookup (C# spec 12.5): the members named `name` in `type`, with members hidden by more derived ones removed
 * and - when `within` is given - inaccessible ones filtered. Returns `{members,inaccessible}`; methods come back as a
 * group (all overloads not hidden by a non-method).
 */
export function lookupMembers(type, name, core, { within = null, throughType = null, includeNested = true } = {}) {
  const all = membersInHierarchy(type, name, core).filter(
    m =>
      !(
        m.kind === SymbolKind.Method &&
        (m.isConstructor || m.methodKind === MethodKind.Destructor || m.methodKind === MethodKind.StaticConstructor)
      ),
  );
  if (includeNested)
    for (const t of type.typeKind === TypeKind.TypeParameter ? [] : baseTypeChain(type, core))
      for (const n of t.getTypeMembers?.(name) ?? []) all.push(n);
  const accessible = [],
    inaccessible = [];
  for (const m of all) {
    if (m.explicitInterfaceSyntax) continue;
    if (
      isAccessible(
        m.originalDefinition ?? m,
        within?.originalDefinition ?? within,
        throughType ? { throughType: throughType.originalDefinition ?? throughType } : {},
      )
    )
      accessible.push(m);
    else inaccessible.push(m);
  }
  if (!accessible.length) return { members: [], inaccessible };
  // The most derived declaration decides the kind; a non-method hides everything below it, methods accumulate overloads.
  const first = accessible[0];
  if (first.kind !== SymbolKind.Method) return { members: [first], inaccessible };
  const methods = [];
  for (const m of accessible) {
    if (m.kind !== SymbolKind.Method) break;
    if (m.isOverride) continue;
    if (!methods.includes(m) && !methods.some(x => x.containingType !== m.containingType && sameParameters(x, m))) methods.push(m);
  }
  // An override stands in for the method it overrides when the base declaration is not itself visible.
  if (!methods.length) return { members: accessible.filter(m => m.kind === SymbolKind.Method), inaccessible };
  return { members: methods, inaccessible };
}
