import { expandTabs, offsetAtVisualColumn, visualColumnAt } from '@sharpforge/text';
import { boxSelectionEdits, createBoxSelections } from '../commands/box-selection.js';

function padding(column, length, { tabSize, insertSpaces }) {
  if (insertSpaces) return ' '.repeat(length);
  const end = column + length;
  let text = '';
  while (column < end) {
    const tabWidth = tabSize - column % tabSize;
    const useTab = tabWidth > 1 && tabWidth <= end - column;
    text += useTab ? '\t' : ' ';
    column += useTab ? tabWidth : 1;
  }
  return text;
}

/** Block shifts change whitespace after the left boundary, independently of the rectangle's right edge. */
export function shiftBlockEdits(context, ranges, direction, count = 1) {
  const tabSize = context.editor.options?.tabSize ?? 4;
  const size = (context.editor.options?.indentSize ?? tabSize) * count;
  const insertSpaces = context.editor.options?.insertSpaces !== false;
  return ranges.flatMap(range => {
    const line = context.line(range.box.line);
    const column = range.box.startColumn;
    const width = visualColumnAt(line, line.length, { tabSize });
    if (width < column) return [];
    let endColumn = column;
    let text = '';
    if (direction > 0) text = padding(column, size, { tabSize, insertSpaces });
    else {
      const expanded = expandTabs(line, { tabSize });
      const point = offsetAtVisualColumn(expanded, column);
      const available = expanded.slice(point.offset).match(/^ */u)[0].length;
      endColumn += Math.min(size, available);
      if (endColumn === column) return [];
    }
    const selections = createBoxSelections(context.buffer, {
      anchorLine: range.box.line, activeLine: range.box.line, anchorColumn: column, activeColumn: endColumn, tabSize
    });
    const [edit] = boxSelectionEdits(context.buffer, selections, text, { padVirtualSpace: false });
    if (!insertSpaces) {
      const startColumn = visualColumnAt(line, edit.start - context.lineStart(range.box.line), { tabSize });
      const end = visualColumnAt(' '.repeat(startColumn) + edit.text, undefined, { tabSize });
      edit.text = padding(startColumn, end - startColumn, { tabSize, insertSpaces });
    }
    return [edit];
  });
}
