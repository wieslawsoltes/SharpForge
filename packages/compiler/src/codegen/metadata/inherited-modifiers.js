/**
 * Custom modifiers a source method takes over from the member it overrides or implements (SF-A02-T30).
 *
 * The runtime matches an override to its slot, and an implementation to its interface member, by name and
 * signature - custom modifiers included (ECMA-335 II.10.3.2, II.12.2). An imported `void M(in int x)` is
 * `M(modreq(InAttribute) int32&)`: a source override written without the modifier declares another method and the
 * abstract slot stays empty (TypeLoadException). So the signature of a source method repeats the modifiers of
 *
 *   the method it overrides (through source overrides in between, up to the imported declaration),
 *   the interface member it implements explicitly, or
 *   the interface member it implements implicitly, when that member has modifiers.
 *
 * Modifiers are read from the original definitions (metadata-import/signature-modifiers.js), slot by slot.
 */
import { SymbolKind } from '../../symbols/types.js';

const cache = new WeakMap();
const definitionOf = symbol => symbol?.originalDefinition ?? symbol ?? null;
const hasModifiers = method => !!method.returnCustomModifiers || method.parameters.some(parameter => parameter.customModifiers);

/** The accessor of `declaration` (a property or event) that plays the role `accessor` plays for its own owner. */
function matchingAccessor(declaration, accessor) {
  const owner = accessor.associatedSymbol;
  if (!owner) return null;
  for (const role of ['getMethod', 'setMethod', 'addMethod', 'removeMethod']) if (owner[role] === accessor) return declaration[role] ?? null;
  return null;
}

/** The interface member a method implements implicitly, from the binder's implementation map of its type. */
function implicitlyImplemented(method) {
  const type = method.containingType,
    owner = method.associatedSymbol ?? null;
  for (const [declaration, implementation] of type?.interfaceImplementations ?? []) {
    if (implementation === method && declaration.kind === SymbolKind.Method) return declaration;
    if (owner && implementation === owner) {
      const accessor = matchingAccessor(declaration, method);
      if (accessor) return accessor;
    }
  }
  return null;
}

/** The member whose signature `method` repeats, or null. */
function signatureSourceOf(method) {
  const explicit = method.explicitInterfaceImplementations?.[0] ?? null;
  return definitionOf(method.overriddenMethod ?? explicit ?? implicitlyImplemented(method));
}

/**
 * The custom modifiers a source method inherits.
 * @param method a source method definition
 * @returns {{returned: object|null, parameters: (object|null)[]}|null} `{outer, inner}` modifier lists per slot
 *   (see signature-modifiers.js), or null when the method repeats no modified signature
 */
export function inheritedSignatureModifiers(method) {
  if (cache.has(method)) return cache.get(method);
  let result = null;
  // Through the source overrides in between: they carry no modifiers of their own.
  for (let source = signatureSourceOf(method), depth = 0; source && depth < 64; source = signatureSourceOf(source), depth++) {
    if (!hasModifiers(source) || source.parameters.length !== method.parameters.length) continue;
    result = { returned: source.returnCustomModifiers ?? null, parameters: source.parameters.map(parameter => parameter.customModifiers ?? null) };
    break;
  }
  cache.set(method, result);
  return result;
}
