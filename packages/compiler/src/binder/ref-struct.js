/**
 * ref struct restrictions (SF-A02-T04.5; C# 7.2, relaxed in C# 13).
 *
 * A ref struct lives on the stack only, so it cannot be: boxed (no conversion to object, ValueType or an interface -
 * CS0029/CS0030 from conversion classification), the element type of an array (CS0611), a field of anything but a
 * ref struct or a static field (CS8345), a type argument unless the parameter `allows ref struct` (CS9244; CS0306
 * before C# 13), captured by a lambda or local function (CS8175), a parameter or local of an async method (CS4012;
 * from C# 13 locals are allowed and only CS4007 when alive across an await) or of an iterator (CS4013 / CS4007).
 * Before C# 13 it cannot implement interfaces (the "ref struct interfaces" feature gate).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, SymbolKind, typeOf } from '../symbols/types.js';

export const refStructFeature = Object.freeze({ name: 'ref structs', version: 7.2 });
export const refStructInterfacesFeature = Object.freeze({ name: 'ref struct interfaces', version: 13 });
export const refAndUnsafeInAsyncFeature = Object.freeze({ name: 'ref and unsafe in async and iterator methods', version: 13 });
/** True for ref structs (Span<T>, ReadOnlySpan<T>, user `ref struct`) and type parameters that allow them. */
export function isRefLike(type) {
  type = typeOf(type);
  return (
    !!type &&
    (type.isRefLikeType === true ||
      (type.typeKind === TypeKind.TypeParameter && type.allowsRefLikeType === true) ||
      (['Span', 'ReadOnlySpan'].includes(type.originalDefinition?.name) &&
        type.originalDefinition?.containingNamespace?.name === 'System' &&
        type.originalDefinition.arity === 1))
  );
}
/** Declaration diagnostics of a type with respect to ref structs. @returns [{code,args,member}] */
export function checkRefStructDeclarations(type, languageVersion = 14) {
  const results = [];
  for (const m of type.getMembers()) {
    const t = m.kind === SymbolKind.Field ? m.type : m.kind === SymbolKind.Property && m.isAutoProperty ? m.type : null;
    if (t && isRefLike(t) && (m.isStatic || !type.isRefLikeType) && !(m.isImplicitlyDeclared && !m.isPositional))
      results.push({ code: DiagnosticId.CS8345, args: [t.toDisplayString()], member: m, onType: true });
  }
  if (type.isRefLikeType && type.interfaces.length && languageVersion < 13)
    results.push({ member: type, feature: refStructInterfacesFeature, onInterfaces: true });
  return results;
}
/** An array of a ref struct is not allowed (CS0611). */
export function checkArrayElementType(elementType) {
  return isRefLike(elementType) ? { code: DiagnosticId.CS0611, args: [elementType.toDisplayString()] } : null;
}
/**
 * A ref struct as a parameter or local of an async method, async lambda or iterator.
 * @param {'parameter'|'local'} what  @param {{isAsync?:boolean,isIterator?:boolean}} method
 * @returns {null|{code,args}|{feature}} a diagnostic, or the language feature the declaration needs
 */
export function checkAsyncOrIteratorUse(type, what, method, languageVersion = 14) {
  if (!isRefLike(type) || !(method.isAsync || method.isIterator)) return null;
  if (what === 'parameter') return { code: method.isAsync ? DiagnosticId.CS4012 : DiagnosticId.CS4013, args: [type.toDisplayString()] };
  // Locals of an iterator were never an error where they are declared; in an async method they are the C# 13 feature
  // "ref and unsafe in async and iterator methods" (Roslyn gates the type of the declaration). What cannot be done at
  // any version is keeping the value across an await or yield: CS4007 (./ref-struct-suspensions.js).
  return languageVersion < 13 && method.isAsync ? { feature: refAndUnsafeInAsyncFeature } : null;
}
/** A ref struct local or parameter (or `this` of a ref struct) captured by a lambda or local function (CS8175). */
export function checkCapture(symbol, type) {
  return isRefLike(type) ? { code: DiagnosticId.CS8175, args: [symbol.name] } : null;
}
/** A ref struct local alive across an await in an async method (C# 13: CS4007). */
export function checkAcrossAwait(type) {
  return isRefLike(type) ? { code: DiagnosticId.CS4007, args: [type.toDisplayString()] } : null;
}
/** True when a conversion would box a ref struct (conversion classification already refuses; this names the reason for messages). */
export function wouldBox(from, to) {
  return (
    isRefLike(from) &&
    (to.specialType === 'System_Object' ||
      to.specialType === 'System_ValueType' ||
      to.typeKind === TypeKind.Interface ||
      to.typeKind === TypeKind.Dynamic)
  );
}
/**
 * Instance methods of object/ValueType cannot be called on a ref struct unless it overrides them (the call would box): CS0029-family; returns true
 * when the call is illegal.
 */
export function callWouldBox(receiverType, method) {
  return (
    isRefLike(receiverType) &&
    !method.isStatic &&
    (method.containingType?.specialType === 'System_Object' || method.containingType?.specialType === 'System_ValueType')
  );
}
