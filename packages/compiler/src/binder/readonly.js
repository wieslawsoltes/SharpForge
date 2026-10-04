/**
 * readonly structs and readonly members (SF-A02-T04.4; C# 7.2 readonly struct, C# 8 readonly members).
 *
 * Declaration rules: every instance field of a readonly struct is readonly (CS8340), its auto-properties have no
 * `set` (CS8341) and it declares no field-like events (CS8342); `readonly` on a member is allowed on struct instance
 * methods, properties and accessors only (CS8656 is the *call-site* warning, CS8657/CS8658/CS8659/CS8660/CS8661 the
 * declaration errors).
 * Call sites: invoking a member on a read-only struct variable (readonly field outside a constructor, `in` parameter,
 * `ref readonly` local, `this` inside a readonly member) must not mutate it. When the invoked member is itself
 * readonly no copy is needed; otherwise the compiler calls it on a defensive copy - and warns CS8656 when the
 * receiver is `this` in a readonly member.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { classifyVariable } from './ref-kinds.js';

export const readonlyStructFeature = Object.freeze({ name: 'readonly structs', version: 7.2 });
export const readonlyMembersFeature = Object.freeze({ name: 'readonly members', version: 8 });
/** True when a method cannot mutate `this`: explicitly readonly, declared in a readonly struct, or an auto-property getter. */
export function isEffectivelyReadOnly(method) {
  const type = method.containingType;
  if (!type || type.typeKind !== TypeKind.Struct || method.isStatic) return false;
  if (method.methodKind === MethodKind.Constructor) return false;
  return (
    type.isReadOnly ||
    method.isReadOnly ||
    method.associatedSymbol?.isReadOnlyMember === true ||
    (method.methodKind === MethodKind.PropertyGet && method.isAutoAccessor === true)
  );
}
const hasReadOnlyModifier = syntax => [...(syntax?.modifiers ?? [])].some(token => token.text === 'readonly');
/** True when the property declaration itself carries `readonly`. */
const declaredReadOnly = property => (property.modifierWords ?? []).includes('readonly') || hasReadOnlyModifier(property.syntax);
/** True when a property has a get and a set accessor and each of them carries `readonly`. */
function everyAccessorDeclaredReadOnly(property) {
  const accessors = [...(property.syntax?.accessorList?.accessors ?? [])];
  return accessors.length > 1 && accessors.every(hasReadOnlyModifier);
}
/** Declaration diagnostics of a readonly struct and of readonly members. @returns [{code,args,member}] */
export function checkReadOnlyDeclarations(type) {
  const results = [];
  if (type.typeKind !== TypeKind.Struct) {
    for (const m of type.getMembers()) {
      const onMethod = m.kind === SymbolKind.Method && m.isReadOnly && !m.isAccessor && m.methodKind === MethodKind.Ordinary;
      if (onMethod || (m.kind === SymbolKind.Property && declaredReadOnly(m))) results.push({ code: DiagnosticId.CS0106, args: ['readonly'], member: m });
    }
    return results;
  }
  for (const m of type.getMembers()) {
    if (m.isImplicitlyDeclared && !m.isPositional) continue;
    if (type.isReadOnly && !m.isStatic) {
      if (m.kind === SymbolKind.Field && !m.isReadOnly) results.push({ code: DiagnosticId.CS8340, args: [], member: m });
      else if (m.kind === SymbolKind.Property && m.isAutoProperty && m.setMethod && !m.setMethod.isInitOnly)
        results.push({ code: DiagnosticId.CS8341, args: [], member: m });
      else if (m.kind === SymbolKind.Event && m.isFieldLike) results.push({ code: DiagnosticId.CS8342, args: [], member: m });
    }
    if (m.kind === SymbolKind.Method && m.isReadOnly && !m.isAccessor) {
      if (m.isStatic) results.push({ code: DiagnosticId.CS8657, args: [m.toDisplayString()], member: m });
      else if (m.methodKind === MethodKind.Constructor) results.push({ code: DiagnosticId.CS0106, args: ['readonly'], member: m });
    }
    if (m.kind === SymbolKind.Property && declaredReadOnly(m)) {
      m.isReadOnlyMember = true;
      if (m.isStatic) results.push({ code: DiagnosticId.CS8657, args: [m.toDisplayString()], member: m });
      else if (m.isAutoProperty && m.setMethod && !m.setMethod.isInitOnly)
        results.push({ code: DiagnosticId.CS8659, args: [m.toDisplayString()], member: m });
    } else if (m.kind === SymbolKind.Property && everyAccessorDeclaredReadOnly(m)) {
      // `readonly` on both accessors says what `readonly` on the property says.
      results.push({ code: DiagnosticId.CS8661, args: [m.toDisplayString()], member: m });
    }
  }
  return results;
}
/**
 * How a struct receiver is passed to an instance member.
 * @returns {{mode:'address'|'copy'|'value',warning?:{code:'CS8656',args}}}
 *   'address' - call on the variable itself; 'copy' - defensive copy first; 'value' - an rvalue receiver (spilled to a temp)
 */
export function receiverPassing(receiver, member, context = {}) {
  const type = receiver.type;
  if (
    !type ||
    type.isValueType !== true ||
    type.typeKind === TypeKind.Enum ||
    (type.specialType && type.specialType !== 'System_Nullable_T')
  )
    return { mode: receiver.type?.isValueType ? 'value' : 'address' };
  const method = member.kind === SymbolKind.Property ? (context.isWrite ? member.setMethod : member.getMethod) : member;
  const c = classifyVariable(receiver, context);
  if (!c.isVariable) return { mode: 'value' };
  if (c.isWritable) return { mode: 'address' };
  // Read-only variable: no copy when the member promises not to mutate.
  if (method && isEffectivelyReadOnly(method)) return { mode: 'address' };
  if (member.kind === SymbolKind.Field) return { mode: 'address' };
  const result = { mode: 'copy' };
  if (receiver.kind === 'This' && context.method && isEffectivelyReadOnly(context.method) && method && !method.isStatic)
    result.warning = {
      code: DiagnosticId.CS8656,
      args: [
        method.methodKind === MethodKind.PropertyGet || method.methodKind === MethodKind.PropertySet
          ? member.toDisplayString() + (method.methodKind === MethodKind.PropertyGet ? '.get' : '.set')
          : member.toDisplayString(),
        'this',
      ],
    };
  return result;
}
/** Writing a member of `this` inside a readonly member or readonly struct (CS1604 through `checkWritable`); true when the context forbids it. */
export function thisIsReadOnly(context) {
  const t = context.containingType;
  return !!t && t.typeKind === TypeKind.Struct && (t.isReadOnly || (!!context.method && isEffectivelyReadOnly(context.method)));
}
