/**
 * Extension method invocation (SF-A02-T06.6, C# spec 12.8.9.3).
 *
 * `receiver.M(args)` falls back to extension methods only when instance lookup finds no applicable method. The search
 * walks outward through the scopes that enclose the call - each namespace declaration, then its using directives
 * (using-namespace and using-static), ending with the compilation unit - and stops at the first scope that offers an
 * applicable candidate; candidates of farther scopes are never considered, so a nearer extension wins without
 * ambiguity and two applicable ones in the same scope are CS0121.
 * The receiver must convert to the `this` parameter by an identity, implicit reference or boxing conversion
 * (C# 14 adds span conversions): numeric and user-defined conversions do not make an extension applicable.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, RefKind } from '../symbols/types.js';
import { NamespaceExtent } from '../symbols/namespaces.js';
import { ConversionKind } from '../conversions/classify.js';

/** Static, non-generic, non-nested classes can declare extension methods. */
export const canDeclareExtensions = type =>
  type.kind === SymbolKind.NamedType && type.typeKind === TypeKind.Class && type.isStatic && type.arity === 0 && !type.containingType;
/**
 * The extension methods named `name` declared by a type. A class read from metadata says whether it declares any
 * (`ExtensionAttribute` on the class), which spares decoding the members of every static class of a namespace.
 */
export function extensionMethodsOf(type, name) {
  if (type.mightContainExtensionMethods === false) return [];
  return canDeclareExtensions(type)
    ? type.getMembers(name).filter(m => m.kind === SymbolKind.Method && m.isExtensionMethod && m.isStatic && m.parameters.length > 0)
    : [];
}
/**
 * The classes declared directly in a namespace that can declare extensions. A namespace read from metadata never
 * changes, and a framework namespace has hundreds of types of which a handful declare extensions: its list is
 * computed once and kept on the namespace symbol (it lives as long as the reference set does).
 */
export function extensionClassesIn(namespace) {
  const parts = namespace.constituentNamespaces;
  if (parts.length !== 1 || parts[0] !== namespace) return parts.flatMap(extensionClassesIn);
  const declares = type => type.mightContainExtensionMethods !== false && canDeclareExtensions(type);
  if (namespace.extent !== NamespaceExtent.Metadata) return namespace.getTypeMembers().filter(declares);
  return (namespace.extensionClasses ??= Object.freeze(namespace.getTypeMembers().filter(declares)));
}
/** The extension methods named `name` declared directly in a namespace. */
export function extensionMethodsInNamespace(namespace, name) {
  return extensionClassesIn(namespace).flatMap(type => extensionMethodsOf(type, name));
}
const receiverKinds = new Set([
  ConversionKind.Identity,
  ConversionKind.ImplicitReference,
  ConversionKind.Boxing,
  ConversionKind.ImplicitSpan,
]);
/**
 * True when `receiverType` can be the receiver of an extension method whose `this` parameter has type `thisType`.
 * `forMethodGroup`: a span conversion (C# 14) is not considered for the receiver of a method group conversion.
 */
export function isValidReceiverConversion(conversions, receiver, thisType, { forMethodGroup = false } = {}) {
  if (receiver.literal === 'null') return thisType.isReferenceType === true || thisType.isNullableValueType;
  if (!receiver.type) return false;
  const c = conversions.classifyStandardImplicit(receiver.type, thisType);
  if (forMethodGroup && c.kind === ConversionKind.ImplicitSpan) return false;
  return c.exists && receiverKinds.has(c.kind);
}
const mentionsTypeParameter = type =>
  type?.typeKind === TypeKind.TypeParameter ||
  !!type?.elementType && mentionsTypeParameter(type.elementType) ||
  (type?.typeArguments ?? []).some(argument => mentionsTypeParameter(argument.type));
/**
 * Whether an extension method could take `receiver` as its `this` argument, before type inference: a `this`
 * parameter that mentions the method's type parameters accepts a receiver that has a construction of the same
 * generic type (`List<int>` for `IEnumerable<T>`), an array or string for a span type, and anything for `T` itself.
 * Used to tell `x.Name` with no extension method for `x` (CS1061) from a method group.
 * @param {(type, definition) => object|null} constructionOf the construction of a generic definition among the
 *   base types and interfaces of a type
 */
export function couldTakeReceiver(conversions, receiver, thisType, constructionOf) {
  if (!mentionsTypeParameter(thisType)) return isValidReceiverConversion(conversions, receiver, thisType);
  const type = receiver.type;
  if (!type || thisType.typeKind === TypeKind.TypeParameter) return !!type;
  if (thisType.elementType) return !!type.elementType;
  const definition = thisType.originalDefinition,
    isSpan = ['Span', 'ReadOnlySpan'].includes(definition.name) && definition.containingNamespace?.name === 'System';
  if (isSpan && (type.elementType || type.specialType === 'System_String')) return true;
  return !!constructionOf(type, definition);
}
/**
 * How the receiver is passed to the candidates of one scope: `ref` when every `this` parameter is `ref` (the
 * receiver of a `ref this` extension is passed by reference without writing `ref`), by value otherwise.
 */
export function receiverRefKind(methods) {
  return methods.length > 0 && methods.every(method => method.parameters[0]?.refKind === RefKind.Ref) ? RefKind.Ref : null;
}
/**
 * Resolves an extension invocation.
 * @param {string} name  @param receiver the bound receiver expression  @param {object[]} args the explicit arguments
 * @param {{methods:MethodSymbol[]}[]} scopes candidate sets ordered from the innermost scope outward (see `extensionScopes`)
 * @param resolver OverloadResolver  @param {{typeArguments?:TypeSymbol[]}} [options]
 * @returns {{succeeded:true,method,scope:number,...}|{succeeded:false,error?:object,found:boolean}} `found` says whether any
 *   extension of that name exists at all (callers report CS1061 when not)
 */
export function resolveExtensionInvocation(name, receiver, args, scopes, resolver, options = {}) {
  let found = false,
    firstFailure = null;
  for (let i = 0; i < scopes.length; i++) {
    const methods = scopes[i].methods.filter(m => m.name === name);
    if (!methods.length) continue;
    found = true;
    const all = [{ ...receiver, name: null, refKind: receiverRefKind(methods) }, ...args];
    const result = resolver.resolve(methods, all, { ...options, name, keepBaseCandidates: true });
    if (result.succeeded) {
      if (!isValidReceiverConversion(resolver.conversions, receiver, result.method.parameters[0].type)) {
        firstFailure ??= {
          succeeded: false,
          found: true,
          error: {
            code: DiagnosticId.CS1929,
            args: [
              receiver.type?.toDisplayString() ?? '<null>',
              name,
              result.method.toDisplayString(),
              result.method.parameters[0].type.toDisplayString(),
            ],
          },
        };
        continue;
      }
      return { ...result, scope: i };
    }
    // An ambiguity between applicable candidates of one scope is final; other failures let outer scopes try.
    if (result.error.code === DiagnosticId.CS0121) {
      const usable = result.ambiguous.filter(m => isValidReceiverConversion(resolver.conversions, receiver, m.parameters[0].type));
      if (usable.length > 1) return { ...result, found: true };
      if (usable.length === 1) {
        const again = resolver.resolve(usable, all, { ...options, name });
        if (again.succeeded) return { ...again, scope: i };
      }
    }
    firstFailure ??= { ...result, found: true, extensionArgumentOffset: 1 };
  }
  return firstFailure ?? { succeeded: false, found };
}
/**
 * The extension scopes of a call site, innermost first.
 * @param {{namespace:NamespaceSymbol|null,usings:{namespaces:NamespaceSymbol[],staticTypes:NamedTypeSymbol[]}}[]} chain
 *   the enclosing namespace declarations from innermost to the compilation unit, each with its own using directives
 */
export function extensionScopes(chain, name) {
  const scopes = [];
  for (const level of chain) {
    if (level.namespace) scopes.push({ methods: extensionMethodsInNamespace(level.namespace, name) });
    const imported = [
      ...(level.usings?.namespaces ?? []).flatMap(n => extensionMethodsInNamespace(n, name)),
      ...(level.usings?.staticTypes ?? []).flatMap(t => extensionMethodsOf(t, name)),
    ];
    scopes.push({ methods: [...new Set(imported)] });
  }
  return scopes.filter(s => s.methods.length);
}
