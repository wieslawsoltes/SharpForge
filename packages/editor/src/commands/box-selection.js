import { expandTabs, offsetAtVisualColumn, visualColumnAt } from '@sharpforge/text';

/** Build rectangular selections in visual columns, including tabs, wide clusters and virtual space. */
export function createBoxSelections(source, {
  anchorLine, activeLine, anchorColumn, activeColumn, tabSize = 4
}) {
  if (![anchorLine, activeLine, anchorColumn, activeColumn].every(value => Number.isInteger(value) && value >= 0)) {
    throw new RangeError('Box positions must use non-negative integer lines and columns');
  }
  anchorLine = Math.min(source.lineCount - 1, anchorLine);
  activeLine = Math.min(source.lineCount - 1, activeLine);
  const startColumn = Math.min(anchorColumn, activeColumn);
  const endColumn = Math.max(anchorColumn, activeColumn);
  const selections = [];
  for (let line = Math.min(anchorLine, activeLine); line <= Math.max(anchorLine, activeLine); line++) {
    const text = source.getLine(line);
    const lineStart = source.getLineStart?.(line) ?? source.lineStart(line);
    const start = offsetAtVisualColumn(text, startColumn, { tabSize });
    const end = offsetAtVisualColumn(text, endColumn, { tabSize, bias: startColumn === endColumn ? 'left' : 'right' });
    const backward = activeColumn < anchorColumn;
    const anchor = backward ? end : start;
    const active = backward ? start : end;
    selections.push({
      anchor: lineStart + anchor.offset, active: lineStart + active.offset,
      anchorVirtualSpace: anchor.virtualSpaces, activeVirtualSpace: active.virtualSpaces,
      box: { line, startColumn, endColumn, tabSize, anchorLine, activeLine, anchorColumn, activeColumn }
    });
  }
  return selections;
}

export function setBoxSelection(model, options) {
  const selections = createBoxSelections(model, options);
  const primaryIndex = Math.max(0, selections.findIndex(selection => selection.box.line === options.activeLine));
  return model.setSelections(selections, { primaryIndex });
}

/** Edit only selected visual cells. Partial tabs are replaced with equivalent unselected prefix/suffix spaces. */
export function boxSelectionEdits(source, selections, text, { padVirtualSpace = true, maxInsertedCharacters = 16 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxInsertedCharacters) || maxInsertedCharacters < 0 || maxInsertedCharacters > 1000000000) {
    throw new RangeError('Invalid box insertion character budget');
  }
  const replacements = Array.isArray(text) ? text : selections.map(() => text);
  if (replacements.length !== selections.length || replacements.some(value => typeof value !== 'string')) {
    throw new RangeError('Expected one text replacement per box row');
  }
  let insertedCharacters = 0;
  return selections.map((selection, index) => {
    const box = selection.box;
    if (!box) throw new TypeError('Selection is not rectangular');
    const line = source.getLine(box.line);
    const lineStart = source.getLineStart?.(box.line) ?? source.lineStart(box.line);
    const start = offsetAtVisualColumn(line, box.startColumn, { tabSize: box.tabSize });
    const end = offsetAtVisualColumn(line, box.endColumn, { tabSize: box.tabSize, bias: 'right' });
    const prefix = (padVirtualSpace ? start.virtualSpaces : 0) || (start.insideTab ? start.intraColumn : 0);
    const suffix = end.insideTab ? end.column - box.endColumn : 0;
    insertedCharacters += prefix + replacements[index].length + suffix;
    if (insertedCharacters > maxInsertedCharacters) throw new RangeError('Box insertion exceeds the character budget');
    const collapsedWide = box.startColumn === box.endColumn && !start.insideTab;
    return {
      start: lineStart + start.offset, end: lineStart + (collapsedWide ? start.offset : end.offset),
      text: ' '.repeat(prefix) + replacements[index] + ' '.repeat(suffix),
      caretInText: prefix + replacements[index].length
    };
  });
}

/** Copy complete selected graphemes, expanding only tabs and virtual cells within the rectangle. */
export function boxSelectionText(source, selection, { padVirtualSpace = true } = {}) {
  const box = selection.box;
  if (!box) throw new TypeError('Selection is not rectangular');
  const expanded = expandTabs(source.getLine(box.line), { tabSize: box.tabSize });
  const first = offsetAtVisualColumn(expanded, box.startColumn);
  const last = offsetAtVisualColumn(expanded, box.endColumn, { bias: 'right' });
  const padding = padVirtualSpace ? Math.max(0, last.virtualSpaces - first.virtualSpaces) : 0;
  return expanded.slice(first.offset, last.offset) + ' '.repeat(padding);
}

export function applyBoxText(model, text, options = {}) {
  const edits = boxSelectionEdits(model, model.selections, text, options);
  let delta = 0;
  const selections = edits.map(edit => {
    const active = edit.start + delta + edit.caretInText;
    delta += edit.text.length - (edit.end - edit.start);
    return { anchor: active, active };
  });
  return model.applyEdits(edits, { command: 'boxTyping', ...options, selections, primaryIndex: model.primaryIndex });
}

export function extendBoxSelection(model, { lineDelta = 0, columnDelta = 0, tabSize = 4 } = {}) {
  const primary = model.primarySelection ?? model.selections[model.primaryIndex ?? 0];
  const position = model.positionAt(primary.active);
  const column = visualColumnAt(model.getLine(position.line), position.character, { tabSize });
  const box = primary.box ?? { anchorLine: position.line, activeLine: position.line, anchorColumn: column, activeColumn: column };
  return setBoxSelection(model, {
    ...box, activeLine: Math.max(0, Math.min(model.lineCount - 1, box.activeLine + lineDelta)),
    activeColumn: Math.max(0, box.activeColumn + columnDelta), tabSize
  });
}
