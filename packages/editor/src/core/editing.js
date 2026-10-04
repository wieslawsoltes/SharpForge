import {nextGraphemeOffset, previousGraphemeOffset, nextWordOffset, previousWordOffset} from '@sharpforge/text';
import {indent} from '../commands/advanced.js';
import {boxSelectionEdits} from '../commands/box-selection.js';
import {moveSelectedLines} from '../commands/line-moves.js';
import {transformOffset} from '../selections.js';

/** Prepare primary and secondary edits against one revision, preserving grapheme and line boundaries. */
export class EditorEditing {
  constructor(editor) { this.editor = editor; }

  insertText(text, options = {}) {
    const {editor} = this;
    if (editor.input.readOnly || typeof text !== 'string') return false;
    if (editor.getSelections().every(selection => selection.box)) {
      const edits = boxSelectionEdits(editor.model, editor.getSelections(), text);
      let delta = 0;
      const selections = edits.map(edit => {
        const active = edit.start + delta + edit.caretInText;
        delta += edit.text.length - (edit.end - edit.start);
        return {anchor: active, active};
      });
      editor.applyEdits(edits, {...options, selections, source: options.source ?? 'boxTyping'});
      return true;
    }
    const edits = [];
    for (const selection of editor.getSelections()) {
      const start = Math.min(selection.anchor, selection.active);
      let end = Math.max(selection.anchor, selection.active);
      let inserted = text;
      const virtualSpaces = selection.activeVirtualSpace ?? selection.virtualSpaces ?? 0;
      if (virtualSpaces && start === end) inserted = ' '.repeat(virtualSpaces) + text;
      if (editor.overtype && start === end && text && !/[\r\n]/.test(text)) {
        const position = editor.model.positionAt(start);
        const line = editor.model.getLine(position.line);
        end = start - position.character + nextGraphemeOffset(line, position.character);
      }
      edits.push({start, end, text: inserted});
    }
    const selections = caretsAfter(edits);
    editor.applyEdits(edits, {selections, source: options.source ?? 'typing', ...options});
    return true;
  }

  insertNewline() {
    const {editor} = this;
    const edits = [];
    const carets = [];
    let delta = 0;
    for (const selection of editor.getSelections()) {
      const start = Math.min(selection.anchor, selection.active);
      const end = Math.max(selection.anchor, selection.active);
      const position = editor.model.positionAt(start);
      const line = editor.model.getLine(position.line).slice(0, position.character);
      const indentation = line.match(/^[\t ]*/)?.[0] ?? '';
      const step = editor.options.insertSpaces ? ' '.repeat(editor.options.indentSize) : '\t';
      const extra = /[\{\[\(]$/.test(line.trimEnd()) ? step : '';
      const ending = editor.options.endOfLine;
      const close = extra && /[}\])]/.test(editor.model.getText(start, Math.min(editor.model.length, start + 1)));
      const text = ending + indentation + extra + (close ? ending + indentation : '');
      edits.push({start, end, text});
      const caret = start + delta + ending.length + indentation.length + extra.length;
      carets.push({anchor: caret, active: caret});
      delta += text.length - (end - start);
    }
    editor.applyEdits(edits, {selections: carets, source: 'newline', undoStop: true});
  }

  deleteText(direction, {word = false, subword = false} = {}) {
    const {editor} = this;
    if (editor.input.readOnly) return;
    const edits = [];
    const selections = editor.getSelections();
    const destinations = [];
    for (const selection of selections) {
      let start = Math.min(selection.anchor, selection.active);
      let end = Math.max(selection.anchor, selection.active);
      if (start === end) {
        const position = editor.model.positionAt(start);
        const text = editor.model.getLine(position.line);
        const base = start - position.character;
        if (direction < 0 && position.character === 0 && start > 0) {
          start -= editor.model.getText(Math.max(0, start - 2), start) === '\r\n' ? 2 : 1;
        } else if (direction > 0 && position.character === text.length && end < editor.model.length) {
          end += editor.model.getText(end, Math.min(editor.model.length, end + 2)) === '\r\n' ? 2 : 1;
        } else if (direction < 0) {
          start = base + (word ? previousWordOffset(text, position.character, {subword}) : previousGraphemeOffset(text, position.character));
        } else {
          end = base + (word ? nextWordOffset(text, position.character, {subword}) : nextGraphemeOffset(text, position.character));
        }
      }
      if (start !== end) edits.push({start, end, text: ''});
      destinations.push(start);
    }
    if (edits.length) {
      const deletes = mergeDeletionRanges(edits);
      const carets = selections.map((selection, index) => {
        const active = transformOffset(destinations[index], deletes, 'left');
        return {...selection, anchor: active, active};
      });
      editor.applyEdits(deletes, {selections: carets, primaryIndex: editor.primaryIndex ?? editor.model.primaryIndex,
        source: 'delete', undoStop: word});
    }
  }

  tab(unindent = false) {
    const {editor} = this;
    const selections = editor.getSelections();
    if (unindent || selections.some(selection => selection.anchor !== selection.active)) return indent(editor, unindent);
    const edits = selections.map(selection => {
      const position = editor.model.positionAt(selection.active);
      const amount = editor.options.indentSize - position.character % editor.options.indentSize;
      return {start: selection.active, end: selection.active, text: editor.options.insertSpaces ? ' '.repeat(amount) : '\t'};
    });
    editor.applyEdits(edits, {selections: caretsAfter(edits), source: 'tab', undoStop: true});
  }

  toggleLineComment(force = null) {
    const {editor} = this;
    const lines = selectedLines(editor);
    const uncomment = force ?? lines.every(line => /^\s*\/\//.test(editor.model.getLine(line)) || !editor.model.getLine(line).trim());
    const edits = [];
    for (const line of lines) {
      const text = editor.model.getLine(line);
      if (!text.trim()) continue;
      const indent = text.match(/^\s*/)[0].length;
      const start = editor.model.offsetAt({line, character: indent});
      if (uncomment) {
        const marker = /^\/\/ ?/.exec(text.slice(indent));
        if (marker) edits.push({start, end: start + marker[0].length, text: ''});
      } else edits.push({start, end: start, text: '// '});
    }
    editor.applyEdits(edits, {source: 'comment', undoStop: true});
  }

  moveLines(direction) { return moveSelectedLines(this.editor, direction); }

}

function mergeDeletionRanges(edits) {
  const merged = [];
  for (const edit of edits.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && edit.start <= previous.end) previous.end = Math.max(previous.end, edit.end);
    else merged.push({...edit});
  }
  return merged;
}

export function caretsAfter(edits) {
  let delta = 0;
  return [...edits].sort((left, right) => left.start - right.start).map(edit => {
    const active = edit.start + delta + edit.text.length;
    delta += edit.text.length - (edit.end - edit.start);
    return {anchor: active, active};
  });
}

function selectedLines(editor) {
  const lines = new Set();
  for (const selection of editor.getSelections()) {
    const start = Math.min(selection.anchor, selection.active);
    const end = Math.max(selection.anchor, selection.active);
    const first = editor.model.positionAt(start).line;
    const last = editor.model.positionAt(end > start ? end - 1 : end).line;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return [...lines].sort((left, right) => left - right);
}
