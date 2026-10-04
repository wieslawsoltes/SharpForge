import {keywords} from '@sharpforge/syntax';
import {parseCompilerInput} from './parse-input.js';
import {buildTypeRenameIndex, unclassifiedTypeReferences, typeDefinitionKey} from './type-rename-index.js';

const identifier = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function unavailable(reason, uri, code = 'SFL2401') {
  return {available: false, reason, diagnostic: {code, severity: 'warning', message: reason, uri, start: 0, length: 0}, edits: []};
}

function analysisFailure(index) {
  const syntax = index.files.flatMap(file => file.diagnostics ?? []).find(row => row.severity === 'error' && /^CS/.test(row.code));
  const error = syntax ?? index.result.diagnostics.find(row => row.severity === 'error');
  if (error) return 'Type rename needs a valid semantic compilation: ' + error.code + ': ' + error.message;
  if (index.result.incomplete || index.result.unsupported) return 'Type rename is unavailable because semantic reference binding is incomplete.';
  return null;
}

function applyEdits(files, edits) {
  const byUri = new Map();
  for (const edit of edits) {
    const list = byUri.get(edit.uri) ?? [];
    list.push(edit);
    byUri.set(edit.uri, list);
  }
  const updated = files.map(file => {
    let text = file.source.text;
    for (const edit of [...(byUri.get(file.source.uri) ?? [])].reverse()) text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
    return {uri: file.source.uri, text, version: file.source.version};
  });
  const shifts = new Map();
  for (const [uri, list] of byUri) {
    let total = 0;
    shifts.set(uri, list.map(edit => {
      total += edit.newText.length - (edit.end - edit.start);
      return {start: edit.start, shift: total};
    }));
  }
  const mapOffset = (uri, offset) => {
    const list = shifts.get(uri) ?? [];
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (list[middle].start < offset) low = middle + 1;
      else high = middle;
    }
    return offset + (list[low - 1]?.shift ?? 0);
  };
  return {updated, mapOffset};
}

function bindingChanged(before, after, mapOffset) {
  const resolved = new Map([...after.references.values()].map(row => [row.uri + ':' + row.start, typeDefinitionKey(row.symbol)]));
  for (const reference of before.references.values()) {
    const actual = resolved.get(reference.uri + ':' + mapOffset(reference.uri, reference.start));
    if (actual !== typeDefinitionKey(reference.symbol, mapOffset)) return true;
  }
  return false;
}

/**
 * Preview a named type rename over complete compilation inputs. Returns version-neutral text spans or an explicit
 * unavailable diagnostic. All edits originate in resolved semantic references, and a second binding rejects capture.
 * Aliases, documentation cref, inactive source, incomplete binding, missing/generated inputs and limits are never skipped.
 */
export function prepareTypeRename(input, {uri, offset = null, name = null, newName, compilationOptions = {}, signal,
  maxFiles = 256, maxCharacters = 2_000_000, maxEdits = 10000} = {}) {
  signal?.throwIfAborted();
  if (typeof newName !== 'string' || !identifier.test(newName) || keywords.has(newName)) {
    return unavailable('The new name must be a non-keyword C# identifier.', uri, 'SFL2402');
  }
  const records = typeof input === 'string' ? [{uri, text: input}] : input;
  if (!Array.isArray(records) || records.length > maxFiles ||
    records.reduce((total, file) => total + (file.source?.text ?? file.text ?? '').length, 0) > maxCharacters) {
    return unavailable('Type rename exceeds its compilation input budget.', uri, 'SFL2405');
  }
  const files = parseCompilerInput(records, compilationOptions);
  const before = buildTypeRenameIndex(files, compilationOptions, signal);
  const failure = analysisFailure(before);
  if (failure) return unavailable(failure, uri);
  const candidates = before.result.assembly.types.filter(type => type.declarations.some(declaration => {
    const span = declaration.syntax.identifier.span;
    return declaration.uri === uri && (offset === null ? type.name === name : span.start <= offset && offset <= span.end);
  }));
  if (candidates.length !== 1) return unavailable('Select one source type declaration matching the file name.', uri);
  const type = candidates[0];
  const unsupported = unclassifiedTypeReferences(before, type.name, signal);
  if (unsupported) return unavailable(unsupported, uri);
  const references = [...before.references.values()].filter(reference => reference.symbol === type);
  if (!references.length || references.length > maxEdits) return unavailable('Type rename exceeds its edit budget.', uri, 'SFL2405');
  if (references.some(reference => reference.uri.startsWith('generated://'))) {
    return unavailable('Type rename would edit read-only generated source.', uri);
  }
  if (references.some(reference => reference.token.valueText !== type.name)) {
    return unavailable('A type reference uses an alias or abbreviated attribute name that is not covered by this rename.', uri);
  }
  const edits = references.map(reference => ({uri: reference.uri, start: reference.start, end: reference.end, newText: newName}))
    .sort((left, right) => left.uri.localeCompare(right.uri) || left.start - right.start);
  const {updated, mapOffset} = applyEdits(files, edits);
  const after = buildTypeRenameIndex(parseCompilerInput(updated, compilationOptions), compilationOptions, signal);
  const changed = analysisFailure(after);
  if (changed || bindingChanged(before, after, mapOffset)) {
    return unavailable(changed ?? 'The new type name would change the binding of an existing reference.', uri, 'SFL2403');
  }
  return {available: true, symbol: {name: type.name, fullName: type.toDisplayString(), kind: type.typeKind,
    locations: type.locations.map(location => ({...location}))}, edits};
}
