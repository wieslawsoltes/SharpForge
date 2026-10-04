import {expandTabs, graphemeSegments, visualColumnAt} from '@sharpforge/text';

/** Every edit is prepared against one snapshot and committed as one multi-caret transaction. */
export function advancedCommands(editor) {
  const transform = (operation, lines = false) => () => transformSelections(editor, operation, lines);
  return {
    'edit.uppercase': () => transformAtCarets(editor, text => text.toUpperCase(), 'word'),
    'edit.lowercase': () => transformAtCarets(editor, text => text.toLowerCase(), 'word'),
    'edit.deleteHorizontalWhitespace': () => transformAtCarets(editor, text => text.replace(/[\t ]+/g, ''), 'whitespace'),
    'edit.joinLines': () => joinLines(editor),
    'edit.sortLines': transform(text => reorderLines(text, lines => lines.sort()), true),
    'edit.reverseLines': transform(text => reorderLines(text, lines => lines.reverse()), true),
    'edit.tabify': transform(text => tabify(text, editor.options.tabSize), true),
    'edit.untabify': transform(text => untabify(text, editor.options.tabSize), true),
    'edit.indent': () => indent(editor, false),
    'edit.outdent': () => indent(editor, true),
    'edit.blockComment': transform(text => text.startsWith('/*') && text.endsWith('*/') ? text.slice(2, -2) : `/*${text}*/`),
    'edit.transposeCharacter': () => transposeCharacter(editor),
    'edit.transposeWord': () => transposeWords(editor),
    'edit.transposeLine': () => editor.moveLines(1),
    'edit.selectWord': () => selectWord(editor)
  };
}

function transformSelections(editor, operation, wholeLines = false) {
  if (editor.input.readOnly) return;
  const ranges = [];
  for (const selection of editor.getSelections()) {
    let start = Math.min(selection.anchor, selection.active);
    let end = Math.max(selection.anchor, selection.active);
    if (wholeLines) {
      const from = editor.model.positionAt(start).line;
      const to = editor.model.positionAt(end > start ? end - 1 : end).line;
      start = editor.model.offsetAt({line: from, character: 0});
      end = editor.model.offsetAt({line: to, character: editor.model.getLine(to).length});
    }
    ranges.push({start, end});
  }
  const edits = (wholeLines ? mergedRanges(ranges) : ranges).map(range => ({...range,
    text: operation(editor.model.getText(range.start, range.end))}));
  editor.applyEdits(mergeEdits(edits), {source: 'advanced', undoStop: true});
}

export function indent(editor, unindent = false) {
  if (editor.input.readOnly) return false;
  const edits = [];
  const lines = new Set();
  for (const selection of editor.getSelections()) {
    const start = Math.min(selection.anchor, selection.active);
    const end = Math.max(selection.anchor, selection.active);
    const first = editor.model.positionAt(start).line;
    const last = editor.model.positionAt(end > start ? end - 1 : end).line;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  const indentation = editor.options.insertSpaces ? ' '.repeat(editor.options.indentSize) : '\t';
  for (const line of lines) {
    const start = editor.model.offsetAt({line, character: 0});
    const text = editor.model.getLine(line);
    const remove = unindent ? text.startsWith('\t') ? 1 : Math.min(editor.options.indentSize, text.match(/^ */)[0].length) : 0;
    edits.push({start, end: start + remove, text: unindent ? '' : indentation});
  }
  editor.applyEdits(edits, {source: unindent ? 'outdent' : 'indent', undoStop: true});
}

function transposeCharacter(editor) {
  if (editor.input.readOnly) return false;
  const edits = [];
  for (const selection of editor.getSelections()) {
    const position = editor.model.positionAt(selection.active);
    const text = editor.model.getLine(position.line);
    const segments = graphemeSegments(text);
    let index = segments.findIndex(segment => segment.end >= position.character);
    if (index < 0) index = segments.length - 1;
    if (index === segments.length - 1) index--;
    if (index < 0 || !segments[index + 1]) continue;
    const base = editor.model.offsetAt({line: position.line, character: 0});
    edits.push({start: base + segments[index].index, end: base + segments[index + 1].end,
      text: segments[index + 1].segment + segments[index].segment});
  }
  editor.applyEdits(mergeEdits(edits), {source: 'transpose', undoStop: true});
}

function transposeWords(editor) {
  if (editor.input.readOnly) return false;
  const edits = [];
  for (const selection of editor.getSelections()) {
    const position = editor.model.positionAt(selection.active);
    const text = editor.model.getLine(position.line);
    const words = [...text.matchAll(/[\p{L}\p{M}\p{N}_]+/gu)];
    let index = words.findIndex(word => word.index + word[0].length >= position.character);
    if (index < 0) index = words.length - 1;
    const first = words[Math.max(0, index - 1)];
    const second = words[Math.max(1, index)];
    if (!first || !second) continue;
    const base = editor.model.getLineStart(position.line);
    edits.push({start: base + first.index, end: base + second.index + second[0].length,
      text: second[0] + text.slice(first.index + first[0].length, second.index) + first[0]});
  }
  editor.applyEdits(mergeEdits(edits), {source: 'transpose-word', undoStop: true});
}

export function untabify(text, tabSize) {
  return text.replace(/[^\r\n]+/g, line => expandTabs(line, {tabSize}));
}

export function tabify(text, tabSize) {
  return text.replace(/[^\r\n]+/g, line => {
    const indentation = line.match(/^[\t ]*/)[0];
    const columns = visualColumnAt(indentation, indentation.length, {tabSize});
    return '\t'.repeat(Math.floor(columns / tabSize)) + ' '.repeat(columns % tabSize) + line.slice(indentation.length);
  });
}

function selectWord(editor) {
  const selections = editor.getSelections().map(selection => {
    const position = editor.model.positionAt(selection.active);
    const line = editor.model.getLine(position.line);
    const base = selection.active - position.character;
    const word = [...line.matchAll(/[\p{L}\p{N}_]+/gu)].find(match => match.index <= position.character && match.index + match[0].length >= position.character);
    return word ? {anchor: base + word.index, active: base + word.index + word[0].length} : selection;
  });
  editor.setSelections(selections);
}

function mergeEdits(edits) {
  const result = [];
  for (const edit of edits.sort((left, right) => left.start - right.start)) {
    if (!result.length || edit.start >= result.at(-1).end) result.push(edit);
  }
  return result;
}

function mergedRanges(ranges) {
  const result = [];
  for (const range of ranges.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({...range});
  }
  return result;
}

function transformAtCarets(editor, transform, kind) {
  if (editor.input.readOnly) return false;
  const edits = editor.getSelections().map(selection => {
    let start = Math.min(selection.anchor, selection.active);
    let end = Math.max(selection.anchor, selection.active);
    if (start === end) {
      const position = editor.model.positionAt(start);
      const text = editor.model.getLine(position.line);
      const expression = kind === 'word' ? /[\p{L}\p{M}\p{N}_]+/gu : /[\t ]+/g;
      const match = [...text.matchAll(expression)].find(item => item.index <= position.character && item.index + item[0].length >= position.character);
      if (match) { start += match.index - position.character; end = start + match[0].length; }
    }
    return {start, end, text: transform(editor.model.getText(start, end))};
  });
  editor.applyEdits(mergeEdits(edits).filter(edit => editor.model.getText(edit.start, edit.end) !== edit.text), {
    source: 'advanced', undoStop: true
  });
}

function reorderLines(text, operation) {
  const eol = text.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  return operation(text.split(/\r\n|\r|\n/)).join(eol);
}

function joinLines(editor) {
  if (editor.input.readOnly) return false;
  const ranges = [];
  for (const selection of editor.getSelections()) {
    const first = editor.model.positionAt(Math.min(selection.anchor, selection.active)).line;
    const end = Math.max(selection.anchor, selection.active);
    const last = selection.anchor === selection.active ? Math.min(editor.model.lineCount - 1, first + 1)
      : editor.model.positionAt(end - 1).line;
    const start = editor.model.getLineStart(first);
    const finish = editor.model.getLineEnd(last);
    ranges.push({start, end: finish});
  }
  const edits = mergedRanges(ranges).map(range => ({...range,
    text: editor.model.getText(range.start, range.end).replace(/[\t ]*(?:\r\n|\r|\n)[\t ]*/g, ' ')}));
  editor.applyEdits(edits, {source: 'join-lines', undoStop: true});
}
