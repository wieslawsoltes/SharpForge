/**
 * `foreach` over a type whose `GetEnumerator` (or, with `await`, `GetAsyncEnumerator`) is an extension method
 * (C# 9, SF-A02-T09.6). The instance pattern and the enumerable interfaces are tried first; this is the fallback.
 */
import { resolveExtensionInvocation, extensionScopes } from '../overload/extension-methods.js';

/**
 * The extension enumerator method that applies to a collection.
 * @param binder the body binder  @param collection the bound collection expression
 * @param {string} name `GetEnumerator` or `GetAsyncEnumerator`
 * @returns the method symbol (constructed for the receiver), or null
 */
export function extensionEnumeratorMethod(binder, collection, name) {
  const levels = binder.typeScope.namespaceChain.map(level => ({
    namespace: level.namespace,
    usings: level.scope.usings ? binder.d.typeBinder.usingsOf(level.scope) : null,
  }));
  const scopes = extensionScopes(levels, name);
  if (!scopes.length) return null;
  const resolved = resolveExtensionInvocation(name, collection, [], scopes, binder.d.overloads, {});
  return resolved.succeeded ? resolved.method : null;
}
