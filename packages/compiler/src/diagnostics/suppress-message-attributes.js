import {DiagnosticId} from './codes.js';
/**
 * `[SuppressMessage]` in programs of the execution profile (SF-A02-T37).
 *
 * The profile has no attributes: every attribute list is rejected with SF1018. SuppressMessageAttribute is the
 * exception that can be accepted without implementing attributes: it is conditional on CODE_ANALYSIS (the compiler
 * emits nothing for it otherwise), nothing at run time reads it, and - as the Roslyn pin in
 * packages/compiler/test/suppression shows - csc does not apply it to compiler diagnostics either. An attribute list
 * made only of well-formed SuppressMessage attributes therefore has no effect on the program, and its SF1018 is
 * removed. Any other attribute, a malformed SuppressMessage, or a program that declares its own type of that name
 * keeps the diagnostic.
 */
const attributeNames = new Set([
  'SuppressMessage',
  'SuppressMessageAttribute',
  'System.Diagnostics.CodeAnalysis.SuppressMessage',
  'System.Diagnostics.CodeAnalysis.SuppressMessageAttribute',
  'global::System.Diagnostics.CodeAnalysis.SuppressMessage',
  'global::System.Diagnostics.CodeAnalysis.SuppressMessageAttribute',
]);
const namedProperties = new Set(['Scope', 'Target', 'Justification', 'MessageId']);
const rejectionCode = DiagnosticId.SF1018;
const textOf = node => node.toString().replace(/\s+/g, '');
const isString = expression => expression?.kind === 'StringLiteralExpression';

/** True for `SuppressMessage("category", "id", Name = "text", ...)`. */
function isWellFormed(attribute) {
  if (!attributeNames.has(textOf(attribute.name))) return false;
  const args = [...(attribute.argumentList?.arguments ?? [])],
    positional = args.filter(arg => !arg.nameEquals && !arg.nameColon),
    named = args.filter(arg => arg.nameEquals);
  if (positional.length !== 2 || positional.length + named.length !== args.length) return false;
  if (!positional.every(arg => isString(arg.expression))) return false;
  return named.every(arg => namedProperties.has(arg.nameEquals.name.identifier.valueText) && isString(arg.expression));
}

/**
 * False when a file cannot contain a SuppressMessage attribute or a type of that name: the name is not in the text,
 * and no identifier is spelled with a Unicode escape. Such a file is not walked at all.
 */
function mayMentionSuppressMessage(text) {
  return text.includes('SuppressMessage') || text.includes('\\u') || text.includes('\\U');
}

/** Collects the spans of attribute lists that only hold SuppressMessage attributes; notes a user type of that name. */
function scan(node, found) {
  if (node.kind === 'AttributeList') {
    const attributes = [...node.attributes];
    if (attributes.length && attributes.every(isWellFormed)) found.lists.push(node.span);
    return;
  }
  if (node.identifier && /Declaration$/.test(node.kind) && /^SuppressMessage(Attribute)?$/.test(node.identifier.valueText)) {
    found.userType = true;
  }
  // Attribute lists sit on declarations, parameters and accessors; statement bodies are searched for local functions' sake.
  for (const child of node.childNodes()) scan(child, found);
}

/**
 * Removes the profile's attribute rejection for attribute lists that only contain SuppressMessage attributes.
 * @param {object[]} files parsed files (`syntax`, `source`, `diagnostics`)
 * @returns {object[]} every parser diagnostic of the files, without those rejections
 */
export function parserDiagnosticsWithoutSuppressMessage(files) {
  const result = [];
  let found = null;
  for (const file of files) {
    const rejected = file.syntax && file.diagnostics.some(d => d.code === rejectionCode);
    if (!rejected) {
      for (const d of file.diagnostics) result.push(d);
      continue;
    }
    if (!found) {
      // A type named SuppressMessage anywhere in the compilation means the attribute is the program's own.
      found = { lists: new Map(), userType: false };
      for (const other of files) {
        if (!other.syntax) continue;
        const scanned = { lists: [], userType: false };
        if (mayMentionSuppressMessage(other.source.text)) scan(other.syntax, scanned);
        found.lists.set(other.source.uri, scanned.lists);
        found.userType = found.userType || scanned.userType;
      }
    }
    const lists = found.userType ? [] : (found.lists.get(file.source.uri) ?? []);
    for (const d of file.diagnostics) {
      const inert = d.code === rejectionCode && lists.some(span => span.start === d.start && span.end === d.start + d.length);
      if (!inert) result.push(d);
    }
  }
  return result;
}
