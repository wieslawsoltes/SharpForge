/**
 * virtual, override, abstract and sealed members (SF-A02-T03.2).
 *
 * `bindOverrides(type)` matches every `override` member with the nearest inherited member of the same signature and
 * records it (`overriddenMethod` / `overriddenMember`): CS0115 (nothing to override), CS0506 (not virtual), CS0239
 * (sealed), CS0507 (accessibility changed), CS0508 (return type changed), CS1715 (property type changed).
 * `checkAbstractImplementation(type)` enforces that a non-abstract class overrides every inherited abstract member
 * (CS0534), and `checkModifiers` the combinations a declaration alone decides: CS0513, CS0500, CS0501, CS0621,
 * CS0112, CS0113, CS0238, CS0549, CS0106.
 * `isVirtualCall` says whether a call binds to a virtual slot (callvirt through the vtable) or directly.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind, Accessibility, TypeCompareKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { baseTypeChain } from '../symbols/substitution.js';
import { sameParameters } from './inheritance.js';

const accessWord = {
  [Accessibility.Public]: 'public',
  [Accessibility.Protected]: 'protected',
  [Accessibility.Internal]: 'internal',
  [Accessibility.ProtectedOrInternal]: 'protected internal',
  [Accessibility.ProtectedAndInternal]: 'private protected',
  [Accessibility.Private]: 'private',
};
const overridable = m =>
  m.kind === SymbolKind.Method ? m.methodKind === MethodKind.Ordinary : m.kind === SymbolKind.Property || m.kind === SymbolKind.Event;
const sameKindAndSignature = (a, b) =>
  a.kind === b.kind &&
  (a.kind === SymbolKind.Method
    ? sameParameters(a, b)
    : a.kind === SymbolKind.Property
      ? a.isIndexer === b.isIndexer && (!a.isIndexer || sameParameters(a, b))
      : true);
/** The nearest inherited member an `override` member could override, or null. */
export function findOverridden(member, type, core) {
  for (const b of baseTypeChain(type, core).slice(1))
    for (const c of b.getMembers(member.name)) if (sameKindAndSignature(member, c)) return c;
  return null;
}
/** True for `protected override bool PrintMembers(StringBuilder)` and `protected override Type EqualityContract` of a derived record. */
function overridesSynthesizedRecordMember(member, type) {
  const base = type.isRecord && type.typeKind === TypeKind.Class ? type.baseType : null;
  if (!base || !(base.originalDefinition ?? base).isRecord) return false;
  if (member.kind === SymbolKind.Method) return member.name === 'PrintMembers' && member.parameters.length === 1;
  return member.kind === SymbolKind.Property && member.name === 'EqualityContract';
}
/** Binds the overrides of a source type. @returns [{code,args,member}] */
export function bindOverrides(type, core, conversions) {
  const results = [];
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return results;
  for (const member of type.getMembers()) {
    if (!overridable(member) || !member.isOverride) continue;
    const base = findOverridden(member, type, core);
    // `PrintMembers` and `EqualityContract` of a base record are synthesized where code is generated; overriding them
    // in a derived record is what the language asks for.
    if (!base && overridesSynthesizedRecordMember(member, type)) continue;
    if (!base) {
      // Roslyn distinguishes a same-named member of another kind or signature only by the message of CS0115.
      results.push({ code: DiagnosticId.CS0115, args: [member.toDisplayString()], member });
      continue;
    }
    if (!(base.isVirtual || base.isAbstract || base.isOverride)) {
      results.push({ code: DiagnosticId.CS0506, args: [member.toDisplayString(), base.toDisplayString()], member });
      continue;
    }
    if (base.isSealed) {
      results.push({ code: DiagnosticId.CS0239, args: [member.toDisplayString(), base.toDisplayString()], member });
      continue;
    }
    member.overriddenMember = base;
    if (member.kind === SymbolKind.Method) member.overriddenMethod = base;
    if (member.kind === SymbolKind.Property) {
      if (member.getMethod && base.getMethod) member.getMethod.overriddenMethod = base.getMethod;
      if (member.setMethod && base.setMethod) member.setMethod.overriddenMethod = base.setMethod;
      if (member.getMethod && !base.getMethod)
        results.push({ code: DiagnosticId.CS0545, args: [member.toDisplayString() + '.get', base.toDisplayString()], member });
      if (member.setMethod && !base.setMethod)
        results.push({ code: DiagnosticId.CS0546, args: [member.toDisplayString() + '.set', base.toDisplayString()], member });
    }
    // protected internal in another assembly may become protected; within one compilation the accessibility must be identical.
    if (member.declaredAccessibility !== base.declaredAccessibility)
      results.push({
        code: DiagnosticId.CS0507,
        args: [member.toDisplayString(), accessWord[base.declaredAccessibility], base.toDisplayString()],
        member,
      });
    else if (member.kind === SymbolKind.Property)
      for (const [own, inherited] of [
        [member.getMethod, base.getMethod],
        [member.setMethod, base.setMethod],
      ]) {
        if (own && inherited && own.declaredAccessibility !== inherited.declaredAccessibility)
          results.push({
            code: DiagnosticId.CS0507,
            args: [own.toDisplayString(), accessWord[inherited.declaredAccessibility], inherited.toDisplayString()],
            member: own,
          });
      }
    const mt = member.kind === SymbolKind.Method ? member.returnType : member.type,
      bt = base.kind === SymbolKind.Method ? base.returnType : base.type;
    if (mt && bt && !mt.isErrorType() && !bt.isErrorType() && !sameReturn(member, base, mt, bt)) {
      // C# 9 covariant returns: a method or get-only property may return a more derived reference type.
      const covariant =
        conversions &&
        (member.kind === SymbolKind.Method || !member.setMethod) &&
        mt.isReferenceType === true &&
        conversions.hasIdentityOrReference(mt, bt);
      if (covariant) member.hasCovariantReturn = true;
      else
        results.push({
          code: member.kind === SymbolKind.Method ? DiagnosticId.CS0508 : DiagnosticId.CS1715,
          args: [member.toDisplayString(), base.toDisplayString(), bt.toDisplayString()],
          member,
        });
    }
  }
  return results;
}
const sameReturn = (a, b, x, y) => {
  if (x.equals(y, TypeCompareKind.IgnoreDynamic)) return true;
  const ia = (a.typeParameters ?? []).indexOf(x),
    ib = (b.typeParameters ?? []).indexOf(y);
  return ia >= 0 && ia === ib;
};
/**
 * Abstract members a non-abstract class leaves unimplemented.
 * @returns [{code:'CS0534',args:[type,member],member}]
 */
export function checkAbstractImplementation(type, core) {
  const results = [];
  if (type.typeKind !== TypeKind.Class || type.isAbstract) return results;
  const chain = baseTypeChain(type, core);
  for (let i = 1; i < chain.length; i++) {
    if (!chain[i].isAbstract) continue;
    for (const m of chain[i].getMembers()) {
      if (!m.isAbstract || (m.kind === SymbolKind.Method && m.isAccessor)) continue;
      // Any more derived class in the chain may provide the override.
      const implemented = chain.slice(0, i).some(t => t.getMembers(m.name).some(c => c.isOverride && sameKindAndSignature(c, m)));
      if (!implemented) {
        if (m.kind === SymbolKind.Property) {
          for (const a of [m.getMethod, m.setMethod])
            if (a)
              results.push({
                code: DiagnosticId.CS0534,
                args: [type.toDisplayString(), m.toDisplayString() + (a === m.getMethod ? '.get' : '.set')],
                member: m,
              });
        } else results.push({ code: DiagnosticId.CS0534, args: [type.toDisplayString(), m.toDisplayString()], member: m });
      }
    }
  }
  return results;
}
/** Declaration-only modifier checks of one member. @returns [{code,args}] */
export function checkModifiers(member, type) {
  const results = [],
    r = (code, args = []) => results.push({ code, args, member });
  if (member.kind === SymbolKind.Field && type.isStatic && !member.isStatic && !member.isImplicitlyDeclared) r(DiagnosticId.CS0708, [member.name]);
  if (member.kind !== SymbolKind.Method && member.kind !== SymbolKind.Property && member.kind !== SymbolKind.Event) return results;
  if (member.isImplicitlyDeclared || (member.kind === SymbolKind.Method && member.isAccessor)) return results;
  const display = member.toDisplayString(),
    inInterface = type.typeKind === TypeKind.Interface,
    vao = member.isVirtual || member.isAbstract || member.isOverride;
  const explicitVao = (member.modifierWords ?? member.syntax?.modifiers?.map(t => t.text) ?? []).some(w =>
    ['virtual', 'abstract', 'override'].includes(w),
  );
  if (member.isStatic && explicitVao && !inInterface) r(DiagnosticId.CS0112, [display]);
  if (member.isOverride && (member.isVirtual || member.isNew)) r(DiagnosticId.CS0113, [display]);
  if (member.isSealed && !member.isOverride && !inInterface) r(DiagnosticId.CS0238, [display]);
  if (member.isAbstract && !inInterface && !type.isAbstract) r(DiagnosticId.CS0513, [display, type.toDisplayString()]);
  // A partial method without an accessibility modifier has a rule of its own for virtual modifiers (CS8798).
  const words = member.modifierWords ?? [],
    isPlainPartial = words.includes('partial') && !words.some(w => ['public', 'private', 'protected', 'internal'].includes(w));
  if (explicitVao && member.declaredAccessibility === Accessibility.Private && !inInterface && !member.explicitInterfaceSyntax && !isPlainPartial)
    r(DiagnosticId.CS0621, [display]);
  if (member.isVirtual && !member.isOverride && type.isSealed && type.typeKind === TypeKind.Class && !type.isStatic && explicitVao)
    r(DiagnosticId.CS0549, [display, type.toDisplayString()]);
  if (type.typeKind === TypeKind.Struct && (member.isVirtual || member.isAbstract) && explicitVao)
    r(DiagnosticId.CS0106, [member.isAbstract ? 'abstract' : 'virtual']);
  if (
    member.kind === SymbolKind.Method &&
    [MethodKind.Ordinary, MethodKind.Constructor, MethodKind.UserDefinedOperator, MethodKind.Conversion, MethodKind.Destructor].includes(
      member.methodKind,
    )
  ) {
    const partial = (member.modifierWords ?? []).includes('partial');
    if (member.isAbstract && member.hasBody && !inInterface) r(DiagnosticId.CS0500, [display]);
    else if (!member.isAbstract && !member.isExtern && !partial && !member.hasBody && !member.isPrimaryConstructor) r(DiagnosticId.CS0501, [display]);
  }
  // Constructors, destructors, operators and indexers of a static class have codes of their own (binder/type-modifiers.js).
  const hasOwnCode =
    (member.kind === SymbolKind.Method && (member.isConstructor || member.methodKind === MethodKind.Destructor)) ||
    (member.kind === SymbolKind.Property && member.isIndexer);
  if (type.isStatic && !member.isStatic && !hasOwnCode) r(DiagnosticId.CS0708, [member.name]);
  return results;
}
/** True when a call to `method` on a receiver dispatches virtually (not `base.M()`, not a struct receiver's own method, not sealed-and-final types). */
export function isVirtualCall(method, { isBaseAccess = false, receiverType = null } = {}) {
  if (isBaseAccess || method.isStatic) return false;
  if (!(method.isVirtual || method.isAbstract || method.isOverride)) return false;
  if (method.isOverride && method.isSealed && receiverType && receiverType.equals?.(method.containingType)) return false;
  return !(receiverType && receiverType.isValueType === true && method.containingType?.equals(receiverType));
}
/** The vtable slot a method occupies: the least derived declaration in its override chain. */
export function virtualSlot(method) {
  let m = method;
  while (m.overriddenMethod) m = m.overriddenMethod;
  return m;
}
