/**
 * What ref safety needs to know about symbols: by-reference kinds, `scoped`, `[UnscopedRef]` and ref fields.
 * Source symbols answer from their declaration syntax; symbols built by hand (tests, metadata) from plain flags.
 */
import { RefKind } from '../../symbols/types.js';

const attributeName = attribute => {
  let name = attribute.name;
  while (name?.kind === 'QualifiedName' || name?.kind === 'AliasQualifiedName') name = name.right ?? name.name;
  return (name?.identifier?.valueText ?? '').replace(/Attribute$/, '');
};

function hasAttribute(syntax, wanted) {
  for (const list of syntax?.attributeLists ?? []) {
    for (const attribute of list.attributes ?? []) {
      if (attributeName(attribute) === wanted) return true;
    }
  }
  return false;
}

const definitionOf = symbol => symbol?.originalDefinition ?? symbol;

/** `[UnscopedRef]` on a parameter, method, property or accessor (an accessor inherits it from its property). */
export function isUnscopedRef(symbol) {
  const definition = definitionOf(symbol);
  if (!definition) return false;
  if (definition.isUnscopedRef === true) return true;
  if (hasAttribute(definition.syntax, 'UnscopedRef')) return true;
  const owner = definition.associatedSymbol;
  return owner ? isUnscopedRef(owner) : false;
}

/** True when the parameter is declared `scoped` (source modifier or symbol flag). */
export function isScopedParameter(parameter) {
  const definition = definitionOf(parameter);
  if (!definition) return false;
  if (definition.scoped) return true;
  return (definition.syntax?.modifiers ?? []).some(modifier => modifier.text === 'scoped');
}

/** The by-reference kind of a parameter, `none` for by-value parameters. */
export const parameterRefKind = parameter => parameter?.refKind ?? RefKind.None;

/** True when the field is a `ref` field of a ref struct (C# 11). */
export function isRefField(field) {
  const definition = definitionOf(field);
  if (!definition) return false;
  if (definition.refKind && definition.refKind !== RefKind.None) return true;
  const typeSyntax = definition.typeSyntax;
  return typeSyntax?.kind === 'RefType' || (typeSyntax?.kind === 'ScopedType' && typeSyntax.type?.kind === 'RefType');
}

/** The method an invocation-like bound node calls: the method, the constructor or the property getter. */
export function invokedMethod(node) {
  if (node.method) return node.method;
  if (node.kind === 'ObjectCreation') return node.constructor && typeof node.constructor === 'object' ? node.constructor : null;
  return node.property?.getMethod ?? null;
}

/** The symbol named in CS8347 / CS8350 messages. */
export function invokedSymbol(node) {
  return node.method ?? (node.kind === 'ObjectCreation' ? invokedMethod(node) : node.property) ?? null;
}

/** True when a by-reference kind lets the callee (or its result) hold on to the referent. */
export const isByReference = refKind => !!refKind && refKind !== RefKind.None;
