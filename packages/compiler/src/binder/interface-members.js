/**
 * Default interface members and static abstract members (SF-A02-T03.6; C# 8 and C# 11).
 *
 * C# 8: an interface member may have a body. A class that does not implement it uses the most specific override
 * among the interfaces it implements - an implementation in I2 : I1 beats one in I1; two unrelated ones are CS8705.
 * C# 11: interfaces may declare `static abstract` / `static virtual` members; implementing types supply static
 * members, and generic code calls them through a type parameter (`T.Create()`), which a back end emits as a
 * `constrained.` call. Such an interface cannot be used as a type argument (CS8920).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { allInterfacesOf } from '../symbols/substitution.js';

export const defaultInterfaceImplementationFeature = Object.freeze({ name: 'default interface implementation', version: 8 });
export const staticAbstractMembersFeature = Object.freeze({ name: 'static abstract members in interfaces', version: 11 });
const sameSignature = (a, b) =>
  a.kind === b.kind &&
  a.parameters?.length === b.parameters?.length &&
  (a.parameters ?? []).every((p, i) => p.type.equals(b.parameters[i].type) && p.refKind === b.parameters[i].refKind);
/**
 * Members an interface cannot declare even with default implementations: instance state and instance constructors.
 * @returns {{code:string,args:string[],member:object}[]}
 */
export function checkInterfaceMemberKinds(iface) {
  const results = [];
  if (iface.typeKind !== TypeKind.Interface) return results;
  for (const member of iface.getMembers()) {
    if (member.isImplicitlyDeclared) continue;
    if (member.kind === SymbolKind.Field && !member.isStatic && !member.isConst) results.push({ code: DiagnosticId.CS0525, args: [], member });
    else if (member.kind === SymbolKind.Method && member.methodKind === MethodKind.Constructor) results.push({ code: DiagnosticId.CS0526, args: [], member });
  }
  return results;
}
/** Interface members with bodies (C# 8 default implementations), accessors excluded. */
export function defaultImplementations(iface) {
  return iface
    .getMembers()
    .filter(
      m =>
        ((m.kind === SymbolKind.Method && m.methodKind === MethodKind.Ordinary) || m.kind === SymbolKind.Property) &&
        !m.isAbstract &&
        !m.isStatic,
    );
}
/** Static abstract / static virtual members of an interface (C# 11). */
export function staticVirtualMembers(iface) {
  return iface.getMembers().filter(m => m.isStatic && (m.isAbstract || m.isVirtual) && !(m.kind === SymbolKind.Method && m.isAccessor));
}
/**
 * The most specific implementation of an interface member for a type that does not implement it itself: among the
 * interfaces of `type`, explicit re-implementations (`void I1.M() { }` in a derived interface) and the declaring
 * member's own body; a candidate in a more derived interface wins.
 * @returns {{member}|{error:{code:'CS8705',args:[member,first,second]}}|{none:true}}
 */
export function mostSpecificImplementation(type, member, core) {
  const declaring = member.containingType,
    candidates = [];
  for (const iface of allInterfacesOf(type, core)) {
    if (iface.equals(declaring)) {
      if (!member.isAbstract) candidates.push({ iface, member });
      continue;
    }
    if (!allInterfacesOf(iface, core).some(i => i.equals(declaring))) continue;
    for (const m of iface.getMembers()) {
      if (
        m.explicitInterfaceType?.equals(declaring) &&
        (m.simpleName ?? m.name) === member.name &&
        sameSignature(m, member) &&
        !m.isAbstract
      )
        candidates.push({ iface, member: m });
      // Re-abstraction (`abstract void I1.M();`) removes the inherited default.
      else if (
        m.explicitInterfaceType?.equals(declaring) &&
        (m.simpleName ?? m.name) === member.name &&
        sameSignature(m, member) &&
        m.isAbstract
      )
        candidates.push({ iface, member: m, reabstracted: true });
    }
  }
  if (!candidates.length) return { none: true };
  // A candidate is shadowed when another candidate's interface derives from its interface.
  const best = candidates.filter(
    c => !candidates.some(o => o !== c && !o.iface.equals(c.iface) && allInterfacesOf(o.iface, core).some(i => i.equals(c.iface))),
  );
  if (best.length === 1) return best[0].reabstracted ? { none: true } : { member: best[0].member };
  return {
    error: { code: DiagnosticId.CS8705, args: [member.toDisplayString(), best[0].member.toDisplayString(), best[1].member.toDisplayString()] },
  };
}
/**
 * Binds `T.Member` where T is a type parameter: the static abstract/virtual members of T's constraint interfaces.
 * @returns the candidate members; the caller marks the call `constrained` to T.
 */
export function staticMembersOfTypeParameter(parameter, name, core) {
  if (parameter.typeKind !== TypeKind.TypeParameter) return [];
  const out = [];
  for (const iface of allInterfacesOf(parameter, core))
    for (const m of iface.getMembers(name)) if (m.isStatic && (m.isAbstract || m.isVirtual)) out.push(m);
  return out;
}
/**
 * A static abstract / virtual interface member named through a type (`T.Zero`, `IAdd<T>.Zero`): it can be reached
 * only through a type parameter, which the access is then constrained to.
 * @returns {null|{constrainedTo:object}|{code:string}} null for any other member; `code` is CS8926
 */
export function staticVirtualAccess(member, receiverType) {
  if (!member.isStatic || !(member.isAbstract || member.isVirtual) || member.containingType?.typeKind !== TypeKind.Interface) return null;
  return receiverType?.typeKind === TypeKind.TypeParameter ? { constrainedTo: receiverType } : { code: DiagnosticId.CS8926 };
}
/** An interface with static abstract members that lack a most specific implementation cannot be a type argument (CS8920). */
export function canBeTypeArgument(iface) {
  return !(iface.typeKind === TypeKind.Interface && staticVirtualMembers(iface).some(m => m.isAbstract));
}
/** A static abstract member is implemented by a public static member with the same signature; returns it or null. */
export function findStaticImplementation(type, member) {
  return (
    type.getMembers(member.name).find(m => m.isStatic && sameSignature(m, member)) ??
    type
      .getMembers()
      .find(m => m.explicitInterfaceType?.equals(member.containingType) && (m.simpleName ?? m.name) === member.name && m.isStatic) ??
    null
  );
}
