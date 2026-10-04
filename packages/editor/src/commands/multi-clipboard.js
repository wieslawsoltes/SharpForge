import { normalizeEol, visualColumnAt } from '@sharpforge/text';
import { replaceSelections } from './multi-caret.js';
import { applyBoxText, boxSelectionEdits, boxSelectionText, createBoxSelections } from './box-selection.js';

export const SELECTION_CLIPBOARD_MIME = 'application/x-sharpforge-selections+json';

/** Return plain text plus a versioned optional payload preserving multiline fragments per caret. */
export function copySelections(model, { eol = model.metadata?.dominantEol ?? '\n' } = {}) {
  const lineCopy = model.selections.every(selection => selection.anchor === selection.active);
  const box = model.selections.every(selection => selection.box);
  const fragments = model.selections.map(selection => {
    const start = Math.min(selection.anchor, selection.active);
    const end = Math.max(selection.anchor, selection.active);
    if (selection.box) return boxSelectionText(model, selection);
    return lineCopy ? model.getLine(model.positionAt(start).line) : model.getText(start, end);
  });
  const kind = box ? 'box' : lineCopy ? 'line' : 'multicaret';
  const text = fragments.join(eol) + (lineCopy && !box ? eol : '');
  return {
    text, fragments, kind, mime: SELECTION_CLIPBOARD_MIME,
    metadata: JSON.stringify({ version: 1, kind, fragments })
  };
}

function readMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata !== 'string' || metadata.length > 16000000) throw new RangeError('Clipboard metadata exceeds limit');
  let value;
  try { value = JSON.parse(metadata); } catch { throw new TypeError('Malformed editor clipboard metadata'); }
  if (value.version !== 1 || !['line', 'box', 'multicaret'].includes(value.kind)
    || !Array.isArray(value.fragments) || value.fragments.length > 10000 || value.fragments.some(text => typeof text !== 'string')) {
    throw new TypeError('Unsupported editor clipboard metadata');
  }
  return value;
}

/** Paste a rectangular block at one caret, creating missing lines in one atomic undo transaction. */
export function pasteBox(model, fragments, options = {}) {
  if (!Array.isArray(fragments) || fragments.length === 0 || fragments.length > 10000) throw new RangeError('Invalid box clipboard rows');
  const primary = model.primarySelection ?? model.selections[model.primaryIndex ?? 0];
  const position = model.positionAt(primary.active);
  const tabSize = options.tabSize ?? 4;
  const column = visualColumnAt(model.getLine(position.line), position.character, { tabSize }) + (primary.activeVirtualSpace ?? 0);
  const existing = Math.min(fragments.length, model.lineCount - position.line);
  const selections = createBoxSelections(model, {
    anchorLine: position.line, activeLine: position.line + existing - 1, anchorColumn: column, activeColumn: column, tabSize
  });
  const edits = boxSelectionEdits(model, selections, fragments.slice(0, existing), options);
  const eol = model.metadata?.dominantEol ?? '\n';
  if (existing < fragments.length) {
    const limit = options.maxInsertedCharacters ?? 16 * 1024 * 1024;
    const inserted = edits.reduce((size, edit) => size + edit.text.length, 0);
    const tailSize = fragments.slice(existing).reduce((size, fragment) => size + eol.length + column + fragment.length, 0);
    if (inserted + tailSize > limit) throw new RangeError('Box insertion exceeds the character budget');
    const tail = fragments.slice(existing).map(fragment => eol + ' '.repeat(column) + fragment).join('');
    const last = edits.at(-1);
    if (last.end === model.length) last.text += tail;
    else edits.push({ start: model.length, end: model.length, text: tail, caretInText: tail.length });
  }
  let delta = 0;
  const resultSelections = edits.map(edit => {
    const active = edit.start + delta + edit.caretInText;
    delta += edit.text.length - (edit.end - edit.start);
    return { anchor: active, active };
  });
  if (existing < fragments.length) {
    const after = model.buffer.prepareEdits(edits).after;
    resultSelections.length = existing;
    for (let index = existing; index < fragments.length; index++) {
      const active = after.lineEnd(position.line + index);
      resultSelections.push({ anchor: active, active });
    }
  }
  return model.applyEdits(edits, { ...options, command: 'pasteBox', undoStop: true, selections: resultSelections });
}

/** Distribute lines/fragments when their count matches carets; otherwise paste identical text at every caret. */
export function pasteSelections(model, text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('Clipboard text must be a string');
  const metadata = readMetadata(options.metadata);
  const eol = model.metadata?.dominantEol ?? '\n';
  const fragments = metadata?.fragments ?? text.split(/\r\n|\r|\n/);
  if ((options.box || metadata?.kind === 'box') && model.selections.length === 1) return pasteBox(model, fragments, options);
  const distributed = fragments.length === model.selections.length ? fragments : model.selections.map(() => text);
  const replacements = distributed.map(fragment => options.preserveEol ? fragment : normalizeEol(fragment, eol));
  if (model.selections.every(selection => selection.box)) return applyBoxText(model, replacements, { ...options, command: 'paste', undoStop: true });
  if (metadata?.kind === 'line' && model.selections.every(selection => selection.anchor === selection.active)) {
    const rows = new Map();
    model.selections.forEach((selection, index) => {
      const start = model.getLineStart(model.positionAt(selection.active).line);
      if (!rows.has(start)) rows.set(start, { start, end: start, text: replacements[index] + eol });
    });
    const edits = [...rows.values()].sort((first, second) => first.start - second.start);
    let delta = 0;
    const selections = edits.map(edit => {
      const active = edit.start + delta + edit.text.length;
      delta += edit.text.length;
      return { anchor: active, active };
    });
    return model.applyEdits(edits, { ...options, command: 'pasteLine', undoStop: true, selections });
  }
  return replaceSelections(model, replacements, { ...options, command: 'paste', undoStop: true });
}
