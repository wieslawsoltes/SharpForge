import {nextGraphemeOffset, previousGraphemeOffset, nextWordOffset, previousWordOffset} from '@sharpforge/text';
import {indent} from '../commands/advanced.js';

/** Prepare primary and secondary edits against one revision, preserving grapheme and line boundaries. */
export class EditorEditing {
  constructor(editor) { this.editor = editor; }

  insertText(text, options = {}) {
    const {editor} = this;
    if (editor.input.readOnly || typeof text !== 'string') return false;
    const edits = [];
    for (const selection of editor.getSelections()) {
      const start = Math.min(selection.anchor, selection.active);
      let end = Math.max(selection.anchor, selection.active);
      let inserted = text;
      if (selection.virtualSpaces && start === end) inserted = ' '.repeat(selection.virtualSpaces) + text;
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
      const close = extra && /[}\])]/.test(editor.model.getText(start, start + 1));
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
    for (const selection of editor.getSelections()) {
      let start = Math.min(selection.anchor, selection.active);
      let end = Math.max(selection.anchor, selection.active);
      if (start === end) {
        const position = editor.model.positionAt(start);
        const text = editor.model.getLine(position.line);
        const base = start - position.character;
        if (direction < 0 && position.character === 0 && start > 0) {
          start -= editor.model.getText(Math.max(0, start - 2), start) === '\r\n' ? 2 : 1;
        } else if (direction > 0 && position.character === text.length && end < editor.model.length) {
          end += editor.model.getText(end, end + 2) === '\r\n' ? 2 : 1;
        } else if (direction < 0) {
          start = base + (word ? previousWordOffset(text, position.character, {subword}) : previousGraphemeOffset(text, position.character));
        } else {
          end = base + (word ? nextWordOffset(text, position.character, {subword}) : nextGraphemeOffset(text, position.character));
        }
      }
      if (start !== end) edits.push({start, end, text: ''});
    }
    editor.applyEdits(edits, {selections: caretsAfter(edits), source: 'delete', undoStop: word});
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

  moveLines(direction) {
    const {editor} = this;
    if (![1, -1].includes(direction) || editor.input.readOnly) return;
    const lines = selectedLines(editor);
    const first = lines[0];
    const last = lines.at(-1);
    if (first === undefined || direction < 0 && first === 0 || direction > 0 && last === editor.model.lineCount - 1) return;
    const before = first + Math.min(0, direction);
    const after = last + Math.max(0, direction);
    const start = editor.model.offsetAt({line: before, character: 0});
    const end = after + 1 < editor.model.lineCount ? editor.model.offsetAt({line: after + 1, character: 0}) : editor.model.length;
    const block = [];
    for (let line = before; line <= after; line++) block.push(editor.model.getLine(line));
    if (direction > 0) block.unshift(block.pop());
    else block.push(block.shift());
    const ending = end > 0 && /[\r\n]/.test(editor.model.getText(end - 1, end)) ? editor.options.endOfLine : '';
    const selections = editor.getSelections().map(selection => ({
      anchor: editor.model.positionAt(selection.anchor), active: editor.model.positionAt(selection.active)
    }));
    editor.applyEdits([{start, end, text: block.join(editor.options.endOfLine) + ending}], {source: 'move-lines', undoStop: true});
    editor.setSelections(selections.map(selection => ({
      anchor: editor.model.offsetAt({...selection.anchor, line: selection.anchor.line + direction}),
      active: editor.model.offsetAt({...selection.active, line: selection.active.line + direction})
    })));
  }
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
