/**
 * Deconstruction (SF-A02-T08.5): how a value splits into parts. A tuple literal splits into its element expressions,
 * a tuple value into its elements, and any other value through a `Deconstruct` method - an instance method, or an
 * extension method in scope - with one `out` parameter per part and a `void` return.
 *
 * The same rules serve deconstructing assignments and declarations (binder/body/deconstruction.js) and positional
 * patterns.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { tupleElements } from '../symbols/tuple-elements.js';
import { extensionScopes, isValidReceiverConversion } from '../overload/extension-methods.js';
import { inferMethodTypeArguments } from '../overload/type-inference.js';
import { lookupMembers } from './inheritance.js';

const isVoid = type => type?.specialType === 'System_Void';
const allOut = parameters => parameters.every(parameter => parameter.refKind === 'out');

/**
 * The `Deconstruct` method that splits a value of `type` into `count` parts.
 * @param binder the body binder  @param receiver a bound expression (or placeholder) of that type
 * @returns {{method: object, isExtension: boolean, partTypes: object[]}|null}
 */
export function findDeconstruct(binder, type, count, receiver) {
  const instance = lookupMembers(type, 'Deconstruct', binder.core, { within: binder.c.containingType }).members.filter(
    member =>
      member.kind === SymbolKind.Method &&
      !member.isStatic &&
      !member.typeParameters?.length &&
      member.parameters.length === count &&
      allOut(member.parameters) &&
      isVoid(member.returnType),
  );
  if (instance.length) return { method: instance[0], isExtension: false, partTypes: instance[0].parameters.map(parameter => parameter.type) };
  const chain = binder.typeScope.namespaceChain.map(level => ({
    namespace: level.namespace,
    usings: level.scope.usings ? binder.d.typeBinder.usingsOf(level.scope) : null,
  }));
  for (const scope of extensionScopes(chain, 'Deconstruct')) {
    for (const candidate of scope.methods) {
      if (candidate.parameters.length !== count + 1 || !allOut(candidate.parameters.slice(1)) || !isVoid(candidate.returnType)) continue;
      const method = constructedOverReceiver(binder, candidate, receiver);
      if (!method || !isValidReceiverConversion(binder.conversions, receiver, method.parameters[0].type)) continue;
      return { method, isExtension: true, partTypes: method.parameters.slice(1).map(parameter => parameter.type) };
    }
  }
  return null;
}

/**
 * A generic extension `Deconstruct<TKey, TValue>(this KeyValuePair<TKey, List<TValue>> pair, out TKey key, ...)`
 * constructed for a receiver: the `out` parts have no type of their own, so every type argument comes from the
 * receiver. @returns the constructed method, the method itself when it is not generic, or null when inference fails
 */
function constructedOverReceiver(binder, method, receiver) {
  if (!method.typeParameters?.length) return method;
  if (!receiver?.type) return null;
  const inferred = inferMethodTypeArguments(method, [method.parameters[0].type], [receiver], binder.conversions, binder.core);
  return inferred.error ? null : method.construct(inferred.typeArguments);
}

/**
 * How a value of `type` splits into `count` parts: `{kind: 'tuple', partTypes}` or `{kind: 'method', method,
 * isExtension, partTypes}`; otherwise `{error: {code, args}[], isArity?}` with the diagnostics Roslyn reports
 * (`isArity` for a tuple of another length, which is reported on the whole deconstruction).
 */
export function deconstructionOf(binder, type, count, receiver) {
  const display = binder.display(type);
  if (type.isTupleType && !type.isDefinition) {
    const partTypes = tupleElements(type).map(argument => argument.type);
    if (partTypes.length !== count) return { isArity: true, error: [{ code: DiagnosticId.CS8132, args: [partTypes.length, count] }] };
    return { kind: 'tuple', partTypes };
  }
  if (type.typeKind === 'dynamic') return { error: [{ code: DiagnosticId.CS8133, args: [] }] };
  const found = findDeconstruct(binder, type, count, receiver);
  if (found) return { kind: 'method', ...found };
  // No method of that name at all is CS1061; one with another number of parameters is CS1501.
  const declared = lookupMembers(type, 'Deconstruct', binder.core, { within: binder.c.containingType }).members.length > 0;
  const error = [declared ? { code: DiagnosticId.CS1501, args: ['Deconstruct', count] } : { code: DiagnosticId.CS1061, args: [display, 'Deconstruct'] }];
  return { error: [...error, { code: DiagnosticId.CS8129, args: [display, count] }] };
}
