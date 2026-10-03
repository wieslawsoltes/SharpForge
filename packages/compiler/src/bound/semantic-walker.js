/**
 * Generic traversal of semantic bound trees (binder/body-binder.js). The nodes are plain objects
 * `{kind, syntax, type, ...}`; children are node-valued fields, lists of nodes, and lists of plain entries holding
 * nodes (arguments `{expression}`, initializers `{target, value}`, switch arms `{pattern, when, value}`,
 * switch sections `{labels, body}`, declarators `{local, value}`).
 */
import { Conversion } from '../conversions/classify.js';

/** Fields that are not children: syntax and symbols, binder state, and the re-bound operation of a compound assignment. */
const notChildren = new Set(['syntax', 'type', 'binder', 'locals', 'lambda', 'conversion', 'mapping', 'constantValue', 'operation']);

const isSymbol = value => typeof value.toDisplayString === 'function';
const isSyntax = value => value.green !== undefined || typeof value.childNodes === 'function';

/** True for a bound node (as opposed to a symbol, a syntax node, a conversion or a plain entry). */
export function isBoundNode(value) {
  return (
    !!value && typeof value === 'object' && typeof value.kind === 'string' && !isSymbol(value) && !isSyntax(value) && !(value instanceof Conversion)
  );
}

function visitValue(value, visit, name) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) visitValue(entry, visit, name);
    return;
  }
  if (isSymbol(value) || isSyntax(value) || value instanceof Conversion) return;
  if (typeof value.kind === 'string') {
    visit(value, name);
    return;
  }
  // A plain entry: its node-valued fields are children.
  for (const [key, inner] of Object.entries(value)) if (!notChildren.has(key) && key !== 'parameter') visitValue(inner, visit, key);
}

/** Calls `visit(child, fieldName)` for every direct child node of `node`, in field order. */
export function forEachChild(node, visit) {
  for (const [name, value] of Object.entries(node)) {
    if (notChildren.has(name) || typeof value === 'function') continue;
    visitValue(value, visit, name);
  }
}

/** Pre-order walk: `enter(node)` returns false to skip the node's children. */
export function walk(node, enter) {
  if (!isBoundNode(node)) return;
  if (enter(node) === false) return;
  forEachChild(node, child => walk(child, enter));
}
