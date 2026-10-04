/** Validate a complete edit set against detached source and semantic state before exposing it for commit. */
export function prepareRefactoring(workspace, edits) {
  const grouped = new Map();
  for (const edit of edits) {
    const source = workspace.documents.get(edit.uri)?.source;
    if (!source || edit.version !== source.version) throw new Error(`Stale or unavailable source: ${edit.uri}`);
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start ||
      edit.end > source.length || typeof edit.newText !== 'string') throw new RangeError('Invalid refactoring edit');
    if (!grouped.has(edit.uri)) grouped.set(edit.uri, []);
    grouped.get(edit.uri).push(edit);
  }
  const changes = new Map();
  for (const [uri, items] of grouped) {
    items.sort((a, b) => a.start - b.start || a.end - b.end);
    const source = workspace.documents.get(uri).source;
    const pieces = [];
    const deltas = [0];
    let offset = 0;
    for (let index = 0; index < items.length; index++) {
      const edit = items[index];
      if (edit.start < offset || index && edit.start === items[index - 1].start) throw new Error('Overlapping refactoring edits');
      pieces.push(source.text.slice(offset, edit.start), edit.newText);
      deltas.push(deltas.at(-1) + edit.newText.length - (edit.end - edit.start));
      offset = edit.end;
    }
    pieces.push(source.text.slice(offset));
    const text = pieces.join('');
    if (text.length > workspace.maxDocumentLength) throw new RangeError('Refactoring exceeds the source size limit');
    changes.set(uri, {uri, text, version: source.version, edits: items, deltas});
  }
  return changes;
}

export function mapRefactoringOffset(changes, uri, offset) {
  const change = changes.get(uri);
  if (!change) return offset;
  let low = 0;
  let high = change.edits.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (change.edits[middle].start < offset) low = middle + 1;
    else high = middle;
  }
  const edit = change.edits[low - 1];
  return edit && offset < edit.end ? edit.start + change.deltas[low - 1] : offset + change.deltas[low];
}

export function validateRefactoring(workspace, edits, {rename} = {}) {
  const changes = prepareRefactoring(workspace, edits);
  if (!changes.size) return {changes, candidate: workspace};
  const candidate = new workspace.constructor({maxDocumentLength: workspace.maxDocumentLength,
    maxDocuments: workspace.maxDocuments, compilationOptions: workspace.compilationOptions, extensions: workspace.extensions,
    extensionOptions: workspace.extensionOptions, additionalFiles: workspace.additionalFiles});
  for (const [uri, document] of workspace.documents) {
    candidate.update(uri, changes.get(uri)?.text ?? document.source.text, document.source.version);
  }
  const before = workspace.sourceModel();
  const after = candidate.sourceModel();
  const message = value => rename ? value.split(rename.symbol.name).join(rename.newName) : value;
  const allowed = new Set(before.result.diagnostics.filter(item => item.severity === 'error').map(item =>
    `${item.uri}:${item.code}:${mapRefactoringOffset(changes, item.uri, item.start)}:${message(item.message)}`));
  const introduced = after.result.diagnostics.filter(item => item.severity === 'error' &&
    !allowed.has(`${item.uri}:${item.code}:${item.start}:${item.message}`));
  if (introduced.length) throw new Error('Refactoring introduces errors: ' + introduced.slice(0, 4).map(item => item.message).join('; '));
  if (rename) validateRenameBindings(before, after, changes, rename);
  return {changes, candidate};
}

function validateRenameBindings(before, after, changes, rename) {
  const target = after.symbolAt(rename.symbol.uri, mapRefactoringOffset(changes, rename.symbol.uri, rename.symbol.start));
  if (!target || target.name !== rename.newName) throw new Error('Renamed declaration no longer binds');
  for (const reference of before.references) {
    const position = mapRefactoringOffset(changes, reference.uri, reference.start);
    const current = after.symbolAt(reference.uri, position);
    const original = before.records.get(before.symbolsById.get(reference.symbolId));
    if (reference.symbolId === rename.symbolId) {
      if (current?.id !== target.id) throw new Error('Rename would change the binding of a target reference');
    } else if (original && (!current || current.name !== original.name || current.kind !== original.kind ||
      current.uri !== original.uri || current.start !== mapRefactoringOffset(changes, original.uri, original.start))) {
      throw new Error('Rename would capture a reference to another symbol');
    }
  }
}
