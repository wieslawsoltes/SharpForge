/**
 * A stable text dump of a semantic bound tree (binder/body-binder.js), one node per line:
 *
 *   Binary operator=+ family=numeric : long
 *     Conversion conversion=ImplicitNumeric : long
 *       Local local=b : byte
 *     Literal : long = long(1)
 *
 * Scalar fields are printed as `name=value`, symbols by display name, expressions end with `: type`, constants with
 * `= value` and nodes with errors with `!`. Used by snapshot tests and for debugging.
 */
import { SymbolKind } from '../symbols/types.js';
import { Conversion } from '../conversions/classify.js';

const structuralFields = new Set([
  'kind',
  'syntax',
  'type',
  'constantValue',
  'convert',
  'materialize',
  'lambda',
  'bindFinal',
  'naturalType',
  'argumentSyntax',
  'methodGroup',
  'mapping',
  'hasErrors',
  'form',
  'locals',
  'binder',
]);
const fieldsWithoutChildren = new Set(['syntax', 'type', 'lambda', 'operation', 'conversion', 'mapping', 'binder', 'locals']);

const isSymbol = value => typeof value?.toDisplayString === 'function';
const isBoundNode = value =>
  !!value && typeof value === 'object' && typeof value.kind === 'string' && !isSymbol(value) && !(value instanceof Conversion);

function describeField(name, value) {
  if (typeof value === 'string' || typeof value === 'number' || value === true) return `${name}=${value}`;
  if (value?.kind === SymbolKind.Local || value?.kind === SymbolKind.Parameter) return `${name}=${value.name}`;
  if (value instanceof Conversion) return `${name}=${value.toString()}`;
  if (isSymbol(value)) return `${name}=${value.toDisplayString()}`;
  return null;
}

function describeNode(node) {
  const details = [];
  for (const [name, value] of Object.entries(node)) {
    if (structuralFields.has(name) || value === null || value === undefined || value === false) continue;
    const text = describeField(name, value);
    if (text) details.push(text);
  }
  let line = node.kind + (details.length ? ' ' + details.join(' ') : '');
  if ('type' in node) line += ' : ' + (node.type ? node.type.toDisplayString() : node.literal ? `<${node.literal}>` : '?');
  if (node.constantValue && !node.constantValue.isNull) line += ' = ' + node.constantValue.toString();
  if (node.hasErrors) line += ' !';
  return line;
}

/** The bound nodes directly under a list entry: a node, an argument `{ expression }` or an initializer `{ target, value }`. */
function nodesOfEntry(entry) {
  if (isBoundNode(entry)) return [entry];
  if (!entry || typeof entry !== 'object') return [];
  return [entry.expression, entry.target, entry.value, entry.spread].filter(isBoundNode);
}

/** @returns {string[]} the dump of a bound node (or a list of nodes) as lines */
export function dumpSemanticTree(node, indent = '') {
  if (Array.isArray(node)) return node.flatMap(item => dumpSemanticTree(item, indent));
  if (!isBoundNode(node)) return [];
  const lines = [indent + describeNode(node)];
  const childIndent = indent + '  ';
  for (const [name, value] of Object.entries(node)) {
    if (fieldsWithoutChildren.has(name) || !value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const entry of value) for (const child of nodesOfEntry(entry)) lines.push(...dumpSemanticTree(child, childIndent));
    } else if (isBoundNode(value)) {
      lines.push(...dumpSemanticTree(value, childIndent));
    }
  }
  return lines;
}
