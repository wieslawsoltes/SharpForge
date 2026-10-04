import { findTextMatches, findLiteralMatch, wordRangeAt } from '@sharpforge/text';

/** Add a caret to a view's selection set; coincident/overlapping selections normalize in the model. */
export function addCaret(model, offset, { primary = true } = {}) {
  const order = Math.max(...model.selections.map(selection => selection.order ?? 0)) + 1;
  const selections = [...model.selections, { anchor: offset, active: offset, order }];
  return model.setSelections(selections, { primaryIndex: primary ? selections.length - 1 : model.primaryIndex });
}

function selectedQuery(model) {
  const primary = model.primarySelection ?? model.selections[model.primaryIndex ?? 0];
  if (primary.anchor !== primary.active) return model.getText(Math.min(primary.anchor, primary.active), Math.max(primary.anchor, primary.active));
  const position = model.positionAt(primary.active);
  const lineStart = model.getLineStart(position.line);
  const range = wordRangeAt(model.getLine(position.line), position.character);
  if (!range.segment) return '';
  model.setSelections([{ anchor: lineStart + range.index, active: lineStart + range.end }]);
  return null;
}

/** Select the word at an empty caret first, then add the next unselected occurrence with wraparound. */
export function addNextOccurrence(model, options = {}) {
  const query = selectedQuery(model);
  if (!query) return model.selections;
  const primary = model.primarySelection ?? model.selections[model.primaryIndex ?? 0];
  const {match} = findLiteralMatch(model.snapshot(), query, {
    ...options, matchCase: options.matchCase ?? true, direction: 1,
    origin: Math.max(primary.anchor, primary.active),
    excludeRanges: model.selections.map(selection => ({
      start: Math.min(selection.anchor, selection.active), end: Math.max(selection.anchor, selection.active)
    }))
  });
  if (!match) return model.selections;
  if (model.selections.length >= 10000) throw new RangeError('Selection limit exceeded: at most 10000 occurrences');
  const order = Math.max(...model.selections.map(selection => selection.order ?? 0)) + 1;
  return model.setSelections([...model.selections, { anchor: match.start, active: match.end, order }], { primaryIndex: model.selections.length });
}

export function addAllOccurrences(model, options = {}) {
  let query = selectedQuery(model);
  if (query === null) query = selectedQuery(model);
  if (!query) return model.selections;
  const found = findTextMatches([{ uri: model.uri, text: model.getText(), version: model.version }], query, {
    ...options, regex: false, matchCase: options.matchCase ?? true, maxMatches: 10000
  });
  if (found.truncated) throw new RangeError('Selection limit exceeded: more than 10000 occurrences');
  if (!found.matches.length) return model.selections;
  return model.setSelections(found.matches.map((match, order) => ({ anchor: match.start, active: match.end, order })));
}

export function removeLastCaret(model) {
  if (model.selections.length === 1) return model.selections;
  const last = model.selections.reduce((result, selection, index, all) => (selection.order ?? index) > (all[result].order ?? result) ? index : result, 0);
  return model.setSelections(model.selections.filter((_, index) => index !== last));
}

export function collapseSelections(model) {
  const primary = model.primarySelection ?? model.selections[model.primaryIndex ?? 0];
  return model.setSelections([{ anchor: primary.active, active: primary.active }]);
}

export function insertCaretsAtLineEnds(model) {
  const lines = new Set();
  for (const selection of model.selections) {
    const start = Math.min(selection.anchor, selection.active);
    const end = Math.max(selection.anchor, selection.active);
    const first = model.positionAt(start).line;
    const last = model.positionAt(end > start ? end - 1 : end).line;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  const selections = [...lines].sort((first, second) => first - second).map(line => {
    const offset = model.lineEnd(line);
    return { anchor: offset, active: offset };
  });
  return model.setSelections(selections);
}

/** Apply all caret replacements as one undo transaction, including virtual-space padding. */
export function replaceSelections(model, text, options = {}) {
  const replacements = Array.isArray(text) ? text : model.selections.map(() => text);
  if (replacements.length !== model.selections.length || replacements.some(value => typeof value !== 'string')) {
    throw new RangeError('Expected one text replacement per selection');
  }
  let delta = 0;
  const selections = [];
  const edits = model.selections.map((selection, index) => {
    const start = Math.min(selection.anchor, selection.active);
    const end = Math.max(selection.anchor, selection.active);
    const padding = start === end ? Math.min(selection.anchorVirtualSpace ?? 0, selection.activeVirtualSpace ?? 0) : 0;
    const inserted = ' '.repeat(padding) + replacements[index];
    const active = start + delta + inserted.length;
    selections.push({ anchor: active, active });
    delta += inserted.length - (end - start);
    return { start, end, text: inserted };
  });
  return model.applyEdits(edits, { command: 'typing', ...options, selections, primaryIndex: model.primaryIndex ?? 0 });
}
