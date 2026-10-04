import {graphemeSegments, visualColumnAt} from '@sharpforge/text';

/** Every edit is prepared against one snapshot and committed as one multi-caret transaction. */
export function advancedCommands(editor) {
  const transform = (operation, lines = false) => () => transformSelections(editor, operation, lines);
  return {
    'edit.uppercase': transform(text => text.toUpperCase()),
    'edit.lowercase': transform(text => text.toLowerCase()),
    'edit.deleteHorizontalWhitespace': transform(text => text.replace(/[\t ]+/g, '')),
    'edit.joinLines': transform(text => text.replace(/[\t ]*\r?\n[\t ]*/g, ' '), true),
    'edit.sortLines': transform(text => text.split('\n').sort().join('\n'), true),
    'edit.reverseLines': transform(text => text.split('\n').reverse().join('\n'), true),
    'edit.tabify': transform(text => tabify(text, editor.options.tabSize), true),
    'edit.untabify': transform(text => untabify(text, editor.options.tabSize), true),
    'edit.indent': () => indent(editor, false),
    'edit.outdent': () => indent(editor, true),
    'edit.blockComment': transform(text => text.startsWith('/*') && text.endsWith('*/') ? text.slice(2, -2) : `/*${text}*/`),
    'edit.transposeCharacter': () => transposeCharacter(editor),
    'edit.transposeWord': transform(transposeWords),
    'edit.transposeLine': () => editor.moveLines(1),
    'edit.selectWord': () => selectWord(editor)
  };
}

function transformSelections(editor, operation, wholeLines = false) {
  if (editor.input.readOnly) return;
  const edits = [];
  for (const selection of editor.getSelections()) {
    let start = Math.min(selection.anchor, selection.active);
    let end = Math.max(selection.anchor, selection.active);
    if (wholeLines) {
      const from = editor.model.positionAt(start).line;
      const to = editor.model.positionAt(end > start ? end - 1 : end).line;
      start = editor.model.offsetAt({line: from, character: 0});
      end = editor.model.offsetAt({line: to, character: editor.model.getLine(to).length});
    }
    const text = editor.model.getText(start, end);
    edits.push({start, end, text: operation(text)});
  }
  editor.applyEdits(mergeEdits(edits), {source: 'advanced', undoStop: true});
}

export function indent(editor, unindent = false) {
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

function transposeWords(text) {
  const matches = [...text.matchAll(/[\p{L}\p{N}_]+/gu)];
  if (matches.length < 2) return text;
  const first = matches[0];
  const second = matches[1];
  return text.slice(0, first.index) + second[0] + text.slice(first.index + first[0].length, second.index)
    + first[0] + text.slice(second.index + second[0].length);
}

export function untabify(text, tabSize) {
  return text.split('\n').map(line => {
    let column = 0;
    let result = '';
    for (const segment of graphemeSegments(line)) {
      if (segment.segment === '\t') {
        const count = tabSize - column % tabSize;
        result += ' '.repeat(count);
        column += count;
      } else {
        result += segment.segment;
        column = visualColumnAt(line, segment.end, {tabSize});
      }
    }
    return result;
  }).join('\n');
}

export function tabify(text, tabSize) {
  return text.split('\n').map(line => {
    const count = line.match(/^ */)[0].length;
    return '\t'.repeat(Math.floor(count / tabSize)) + ' '.repeat(count % tabSize) + line.slice(count);
  }).join('\n');
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
