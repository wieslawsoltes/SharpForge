/**
 * Interface implementation (SF-A02-T03.3, C# spec 18.6): which member of a class or struct implements each member of
 * each interface it lists or inherits - removing the old "IDisposable only" restriction.
 *
 * For an interface member, in order: an explicit implementation in the type (`void I.M()`), a public instance member
 * of the type with the same signature, then the same search in each base class (an inherited member implements the
 * interface too), and finally the most specific default implementation among the interfaces of the type (C# 8,
 * ./interface-members.js): the member's own body or an explicit implementation in a derived interface. A type that
 * re-lists an interface re-implements it: the search starts at that type again.
 *   CS8705 two interfaces implement the member and neither derives from the other
 *   CS0535 not implemented            CS0738 a candidate has the wrong return type
 *   CS0736 the candidate is static    CS0737 the candidate is not public
 *   CS0539 explicit member not found in the interface      CS0540 the type does not implement that interface
 *   CS9334 an explicit implementation whose type differs from the member's
 * The resulting map (`type.interfaceImplementations`) is what a back end emits as MethodImpl rows / interface vtables.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind, Accessibility, TypeCompareKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { baseTypeChain, allInterfacesOf } from '../symbols/substitution.js';
import { mostSpecificImplementation } from './interface-members.js';

const sameType = (a, b, ma, mb) => {
  if (!a || !b) return a === b;
  if (a.equals(b, TypeCompareKind.IgnoreDynamic)) return true;
  const ia = (ma.typeParameters ?? []).indexOf(a),
    ib = (mb.typeParameters ?? []).indexOf(b);
  if (ia >= 0 && ia === ib) return true;
  return mapMethodTypeParameters(a, ma) === mapMethodTypeParameters(b, mb);
};
const mapMethodTypeParameters = (t, m) => {
  let text = t.toDisplayString();
  (m.typeParameters ?? []).forEach((p, i) => {
    text = text.replace(new RegExp('\\b' + p.name + '\\b', 'g'), '!!' + i);
  });
  return text;
};
const parametersMatch = (a, b) =>
  a.parameters.length === b.parameters.length &&
  (a.arity ?? 0) === (b.arity ?? 0) &&
  a.parameters.every((p, i) => p.refKind === b.parameters[i].refKind && sameType(p.type, b.parameters[i].type, a, b));
const typeOfMember = m => (m.kind === SymbolKind.Method ? m.returnType : m.type);
const simpleName = m => m.simpleName ?? m.name;
/**
 * Members of an interface that need (or can take) an implementation: instance methods, properties, indexers and
 * events, and - C# 11 - the static abstract ones.
 */
export function implementableMembers(iface) {
  return iface
    .getMembers()
    .filter(
      m =>
        (!m.isStatic || m.isAbstract) &&
        ((m.kind === SymbolKind.Method && (m.methodKind === MethodKind.Ordinary || m.methodKind === MethodKind.UserDefinedOperator)) ||
          m.kind === SymbolKind.Property ||
          m.kind === SymbolKind.Event) &&
        m.declaredAccessibility !== Accessibility.Private,
    );
}
function matches(candidate, member) {
  if (candidate.kind !== member.kind) return false;
  if (member.kind === SymbolKind.Method) return parametersMatch(candidate, member);
  if (member.kind === SymbolKind.Property)
    return candidate.isIndexer === member.isIndexer && (!member.isIndexer || parametersMatch(candidate, member));
  return true;
}
/**
 * Finds the implementation of one interface member for a type.
 * @returns {{member}|{error:{code,args},close?:object}|{defaultImplementation:member}}
 */
export function findImplementation(type, iface, member, core) {
  const chain = type.typeKind === TypeKind.Struct ? [type] : baseTypeChain(type, core);
  let close = null;
  for (const t of chain) {
    // Explicit implementations are named `Namespace.IFace.Member`.
    const explicit = t
      .getMembers()
      .find(m => m.explicitInterfaceType && m.explicitInterfaceType.equals(iface) && simpleName(m) === member.name && matches(m, member));
    // An explicit implementation must have exactly the type of the member it implements (CS9334): covariance does not apply.
    if (explicit && sameType(typeOfMember(explicit), typeOfMember(member), explicit, member)) return { member: explicit, isExplicit: true };
    for (const c of t.getMembers(member.name)) {
      if (c.explicitInterfaceSyntax || !matches(c, member)) continue;
      const sameReturn = sameType(typeOfMember(c), typeOfMember(member), c, member);
      // A static abstract member is implemented by a static member, an instance member by an instance member.
      if (!!c.isStatic !== !!member.isStatic) {
        close ??= { code: member.isStatic ? DiagnosticId.CS8928 : DiagnosticId.CS0736, candidate: c };
        continue;
      }
      if (c.declaredAccessibility !== Accessibility.Public) {
        close ??= { code: DiagnosticId.CS0737, candidate: c };
        continue;
      }
      if (!sameReturn) {
        close ??= { code: DiagnosticId.CS0738, candidate: c };
        continue;
      }
      if (member.kind === SymbolKind.Property && ((member.getMethod && !c.getMethod) || (member.setMethod && !c.setMethod))) {
        close ??= { code: DiagnosticId.CS0535, candidate: c, accessor: member.getMethod && !c.getMethod ? 'get' : 'set' };
        continue;
      }
      return { member: c, isExplicit: false, declaredIn: t };
    }
    // A base class that lists the interface already implements it (possibly through its own bases).
    if (t !== type && t.interfaces?.some(i => i.equals(iface)) && !close) break;
  }
  if (!member.isAbstract) return { defaultImplementation: member };
  const typeName = type.toDisplayString(),
    memberName = member.toDisplayString();
  if (close?.code === DiagnosticId.CS0738)
    return {
      error: { code: DiagnosticId.CS0738, args: [typeName, memberName, close.candidate.toDisplayString(), typeOfMember(member).toDisplayString()] },
    };
  if (close?.code === DiagnosticId.CS0736 || close?.code === DiagnosticId.CS0737 || close?.code === DiagnosticId.CS8928)
    return { error: { code: close.code, args: [typeName, memberName, close.candidate.toDisplayString()] } };
  if (close?.accessor) return { error: { code: DiagnosticId.CS0535, args: [typeName, memberName + '.' + close.accessor] } };
  if (member.kind === SymbolKind.Property && !member.isIndexer) {
    const parts = [member.getMethod && 'get', member.setMethod && (member.setMethod.isInitOnly ? 'init' : 'set')].filter(Boolean);
    return { errors: parts.map(p => ({ code: DiagnosticId.CS0535, args: [typeName, memberName + '.' + p] })) };
  }
  return { error: { code: DiagnosticId.CS0535, args: [typeName, memberName] } };
}
/**
 * Maps every interface member to its implementation for a class or struct.
 * @param {(member)=>void} bindExplicit resolves `member.explicitInterfaceType` for explicit implementations (done by the caller's type binder)
 * @returns {{map:Map<object,object>,diagnostics:{code,args,interface?:object,member?:object}[]}}
 */
export function bindInterfaceImplementations(type, core) {
  const diagnostics = [],
    map = new Map();
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return { map, diagnostics };
  const all = allInterfacesOf(type, core);
  // Explicit implementations must name an interface of the type and one of its members.
  for (const m of type.getMembers()) {
    const iface = m.explicitInterfaceType;
    if (!iface || iface.isErrorType?.()) continue;
    if (m.kind === SymbolKind.Method && m.isAccessor) continue;
    if (iface.typeKind !== TypeKind.Interface) {
      diagnostics.push({ code: DiagnosticId.CS0538, args: [iface.toDisplayString()], member: m, onInterfaceName: true });
      continue;
    }
    if (!all.some(i => i.equals(iface))) {
      diagnostics.push({ code: DiagnosticId.CS0540, args: [m.toDisplayString(), iface.toDisplayString()], member: m, onInterfaceName: true });
      continue;
    }
    const implemented = implementableMembers(iface).find(im => im.name === simpleName(m) && matches(m, im));
    if (!implemented) diagnostics.push({ code: DiagnosticId.CS0539, args: [m.toDisplayString()], member: m });
    else if (!sameType(typeOfMember(m), typeOfMember(implemented), m, implemented)) {
      const args = [m.toDisplayString(), typeOfMember(implemented).toDisplayString(), implemented.toDisplayString()];
      diagnostics.push({ code: DiagnosticId.CS9334, args, member: m });
    }
  }
  // Only interfaces this type lists itself (or gains through them) are checked here; base classes were checked on their own.
  const inheritedFromBase = type.typeKind === TypeKind.Class && type.baseType ? allInterfacesOf(type.baseType, core) : [];
  const listed = type.interfaces;
  for (const iface of all) {
    const relisted = listed.some(i => i.equals(iface) || allInterfacesOf(i, core).some(x => x.equals(iface)));
    if (!relisted && inheritedFromBase.some(i => i.equals(iface))) continue;
    for (const member of implementableMembers(iface)) {
      const found = findImplementation(type, iface, member, core),
        // Not implemented by the type or a base class: the most specific implementation among its interfaces (C# 8).
        specific = found.member ? null : mostSpecificImplementation(type, member, core),
        implementation = found.member ?? specific.member;
      if (implementation) {
        map.set(member, implementation);
        if (implementation.kind === SymbolKind.Property) {
          if (member.getMethod && implementation.getMethod) map.set(member.getMethod, implementation.getMethod);
          if (member.setMethod && implementation.setMethod) map.set(member.setMethod, implementation.setMethod);
        }
      } else if (specific.error) diagnostics.push({ ...specific.error, interface: iface, member });
      else {
        // No implementation at all, or a derived interface made the member abstract again.
        const missing = found.defaultImplementation ? [{ code: DiagnosticId.CS0535, args: [type.toDisplayString(), member.toDisplayString()] }] : null;
        for (const error of missing ?? found.errors ?? [found.error]) diagnostics.push({ ...error, interface: iface, member });
      }
    }
  }
  return { map, diagnostics };
}
/**
 * Implicit implementations of non-public interface methods and accessors (C# 10; CS8704 below it, reported at the
 * implementing method).
 * @param {Map<object,object>} map interface member -> implementation, as `bindInterfaceImplementations` returns it
 * @returns {{implementation:object, args:string[]}[]} the type, the interface member and the implementation as displayed
 */
export function nonPublicImplicitImplementations(type, map) {
  const rows = [];
  for (const [member, implementation] of map) {
    if (member.kind !== SymbolKind.Method || implementation === member || implementation.explicitInterfaceType) continue;
    if (implementation.containingType !== type || implementation.associatedSymbol?.explicitInterfaceType) continue;
    const accessibility = member.declaredAccessibility ?? member.associatedSymbol?.declaredAccessibility;
    if (accessibility === Accessibility.Public) continue;
    rows.push({ implementation, args: [type.toDisplayString(), member.toDisplayString(), implementation.toDisplayString()] });
  }
  return rows;
}
/** The MethodImpl rows a type needs: explicit implementations, and implicit ones whose name or declaring type differs from the interface method. */
export function methodImplRows(type, map) {
  const rows = [];
  for (const [declaration, body] of map) {
    if (declaration.kind !== SymbolKind.Method || body === declaration) continue;
    if (
      body.explicitInterfaceType ||
      body.name !== declaration.name ||
      (body.containingType !== type && body.containingType?.originalDefinition !== type.originalDefinition)
    )
      rows.push({ class: type, body, declaration });
  }
  return rows;
}
