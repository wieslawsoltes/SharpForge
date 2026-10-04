/** Move each disjoint selected line block once; retain physical EOLs and commit selections with the edit. */
export function moveSelectedLines(editor, direction) {
  if (![1, -1].includes(direction) || editor.input.readOnly) return false;
  const {model} = editor;
  const selections = editor.getSelections();
  const selected = new Set();
  for (const selection of selections) {
    const start = Math.min(selection.anchor, selection.active);
    const end = Math.max(selection.anchor, selection.active);
    const first = model.positionAt(start).line;
    const last = model.positionAt(end > start ? end - 1 : end).line;
    for (let line = first; line <= last; line++) selected.add(line);
  }
  const groups = [];
  for (const line of [...selected].sort((left, right) => left - right)) {
    if (groups.at(-1)?.last === line - 1) groups.at(-1).last = line;
    else groups.push({first: line, last: line});
  }
  const moving = groups.filter(group => direction < 0 ? group.first > 0 : group.last < model.lineCount - 1);
  const edits = moving.map(group => {
    const first = group.first + Math.min(0, direction);
    const last = group.last + Math.max(0, direction);
    const records = [];
    for (let line = first; line <= last; line++) {
      const end = model.getLineEnd(line);
      const next = line + 1 < model.lineCount ? model.getLineStart(line + 1) : model.length;
      records.push({text: model.getLine(line), eol: model.getText(end, next)});
    }
    const content = records.map(record => record.text);
    if (direction > 0) content.unshift(content.pop());
    else content.push(content.shift());
    return {start: model.getLineStart(first), end: last + 1 < model.lineCount ? model.getLineStart(last + 1) : model.length,
      text: content.map((text, index) => text + records[index].eol).join('')};
  });
  if (!edits.length) return false;
  const after = model.buffer.prepareEdits(edits).after;
  const transformed = selections.map(selection => {
    const first = model.positionAt(Math.min(selection.anchor, selection.active)).line;
    const delta = moving.some(group => first >= group.first && first <= group.last) ? direction : 0;
    const offset = before => {
      const position = model.positionAt(before);
      return after.offsetAt({...position, line: Math.min(after.lineCount - 1, position.line + delta)});
    };
    return {...selection, anchor: offset(selection.anchor), active: offset(selection.active)};
  });
  return editor.applyEdits(edits, {source: 'move-lines', undoStop: true, selections: transformed});
}
