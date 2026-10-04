/**
 * Binding rules of async streams (SF-A02-T09.4): `await foreach` and `await using`.
 *
 *   await foreach   the collection has an accessible `GetAsyncEnumerator` whose result has `MoveNextAsync` and
 *                   `Current` (the pattern; from C# 9 it may be an extension method), or implements
 *                   `IAsyncEnumerable<T>`; CS8411 otherwise, CS8415 when it is enumerable synchronously
 *   foreach         CS8414 instead of CS1579 when the collection is enumerable asynchronously
 *   await using     the resource implements `IAsyncDisposable` or has a suitable `DisposeAsync` (CS8410)
 *   using           CS8418 instead of CS1674 when the resource is disposable asynchronously
 *
 * Both statements are awaits: outside an async function they report CS4032, CS4033 or CS4034 at the `await` keyword.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { lookupMembers } from './inheritance.js';
import { extensionEnumeratorMethod } from './foreach-extension.js';
import { findConstruction, implementsInterface } from '../symbols/substitution.js';

const callableWithoutArguments = method =>
  method.kind === SymbolKind.Method && !method.isStatic && method.parameters.every(p => p.isOptional || p.isParams);

function instanceMethod(type, name, core, within) {
  return lookupMembers(type, name, core, { within }).members.find(callableWithoutArguments) ?? null;
}

/**
 * How `await foreach` enumerates a collection type.
 * @returns {null|{getEnumerator, moveNext, current, dispose, elementType}} the members of the pattern (symbols, or
 *   null for the ones an interface supplies) and the element type; null when the type is not asynchronously enumerable
 */
export function asyncEnumeration(type, core, within = null) {
  const pattern = enumeratorPattern(instanceMethod(type, 'GetAsyncEnumerator', core, within), core, within);
  if (pattern) return pattern;
  const generic = findConstruction(type, core.iasyncEnumerableT, core);
  if (!generic) return null;
  return { getEnumerator: null, moveNext: null, current: null, dispose: null, elementType: generic.typeArguments[0].type };
}

/** The members of the pattern that starts at `getEnumerator` (a method symbol or null), or null when it is incomplete. */
function enumeratorPattern(getEnumerator, core, within) {
  const enumerator = getEnumerator?.returnType;
  if (!enumerator || enumerator.isErrorType()) return null;
  const moveNext = instanceMethod(enumerator, 'MoveNextAsync', core, within),
    current = lookupMembers(enumerator, 'Current', core, { within }).members.find(m => m.kind === SymbolKind.Property) ?? null;
  if (!moveNext || !current) return null;
  return { getEnumerator, moveNext, current, dispose: instanceMethod(enumerator, 'DisposeAsync', core, within), elementType: current.type };
}

/** True when a type can be enumerated by a synchronous `foreach`. */
function isEnumerable(type, core, within) {
  if (type.elementType || type.specialType === 'System_String') return true;
  return !!instanceMethod(type, 'GetEnumerator', core, within) || implementsInterface(type, core.ienumerable, core);
}

/**
 * How `await foreach (... in collection)` enumerates, reporting CS8411 or CS8415 when the collection is not
 * asynchronously enumerable.
 * @param binder the body binder  @param collection the bound collection  @param syntax the collection expression
 * @returns the enumeration (see `asyncEnumeration`), or null after reporting
 */
export function bindAsyncForEach(binder, collection, syntax) {
  const type = collection.type,
    within = binder.c.containingType,
    enumeration = asyncEnumeration(type, binder.core, within);
  if (enumeration) return enumeration;
  // C# 9: the enumerator comes from an extension method `GetAsyncEnumerator(this T)`.
  const extension = extensionEnumeratorMethod(binder, collection, 'GetAsyncEnumerator'),
    extended = enumeratorPattern(extension, binder.core, within);
  if (extended) {
    binder.d.gate(binder.c.uri, syntax, 'ExtensionGetAsyncEnumerator');
    return { ...extended, isExtension: true };
  }
  const display = binder.display(type);
  binder.report(syntax, isEnumerable(type, binder.core, within) ? DiagnosticId.CS8415 : DiagnosticId.CS8411, [display, 'GetAsyncEnumerator']);
  return null;
}

/** True when a type the synchronous `foreach` cannot enumerate is enumerable with `await foreach` (CS8414). */
export function isOnlyAsyncEnumerable(type, core, within = null) {
  return !!asyncEnumeration(type, core, within);
}

/** True when a type can be disposed by `await using`: `IAsyncDisposable` or an accessible `DisposeAsync()`. */
export function isAsyncDisposable(type, core, within = null) {
  return implementsInterface(type, core.iasyncDisposable, core) || !!instanceMethod(type, 'DisposeAsync', core, within);
}
