/**
 * Custom modifiers of imported method signatures (ECMA-335 II.23.2.7).
 *
 * A method is referenced by name and signature, and the signature includes its custom modifiers: the getter of
 * `ReadOnlySpan<T>.this[int]` returns `ref readonly T`, written `modreq(InAttribute) T&`, and a MemberRef without the
 * modifier names a method that does not exist. The importer keeps them on the symbols it creates so that the emitter
 * can write the signature back exactly:
 *
 *   method.returnCustomModifiers, parameter.customModifiers = { outer: [modifier], inner: [modifier] }
 *
 * `outer` modifiers precede `BYREF` (or the type, when the slot is not by reference), `inner` ones follow `BYREF`.
 * A modifier is `{ isOptional, type }`; `type` is resolved on first use. Slots without modifiers get no property.
 */

function wrap(modifiers, resolve) {
  return Object.freeze(
    (modifiers ?? []).map(modifier => {
      let type = null;
      return Object.freeze({
        isOptional: modifier.isOptional,
        get type() {
          return (type ??= resolve(modifier.token));
        },
      });
    }),
  );
}

function modifiersOf(node, resolve) {
  const outer = node.modifiers,
    inner = node.kind === 'byref' ? node.element?.modifiers : null;
  if (!outer?.length && !inner?.length) return null;
  return Object.freeze({ outer: wrap(outer, resolve), inner: wrap(inner, resolve) });
}

/**
 * Records the custom modifiers of a parsed method signature on the imported method and its parameters.
 * @param method the imported MethodSymbol  @param signature the parsed MethodDefSig (`returnType`, `parameters`)
 * @param {(token: number) => object} resolve the type symbol of a modifier's TypeDefOrRef token
 */
export function attachSignatureModifiers(method, signature, resolve) {
  const returned = modifiersOf(signature.returnType, resolve);
  if (returned) method.returnCustomModifiers = returned;
  for (let index = 0; index < signature.parameters.length; index++) {
    const modifiers = modifiersOf(signature.parameters[index], resolve);
    if (modifiers) method.parameters[index].customModifiers = modifiers;
  }
}
