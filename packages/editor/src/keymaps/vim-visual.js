import { offsetAtVisualColumn } from '@sharpforge/text';
import { createBoxSelections } from '../commands/box-selection.js';
import { adjacentCharacter } from '../commands/movement.js';
import { visualPointColumn } from './vim-motions.js';

/** Inclusive Vim block endpoints use the shared tab, grapheme and virtual-column model. */
export function visualRanges(vim) {
  const context = vim.context;
  const anchor = vim.visualAnchor;
  const head = vim.visualHead;
  const anchorLine = context.position(anchor).line;
  const activeLine = context.position(head).line;
  const first = Math.min(anchorLine, activeLine);
  const last = Math.max(anchorLine, activeLine);
  vim.visualRange = { first, last };
  if (vim.mode === 'visual-line') return [{ start: context.lineStart(first), end: context.lineEnd(last, true), linewise: true }];
  if (vim.mode === 'visual-block') {
    if (last - first >= 10000) throw new RangeError('Vim block selection exceeds 10,000 rows');
    const anchorColumn = vim.visualAnchorColumn ?? visualPointColumn(context, anchor);
    let activeColumn = vim.visualHeadColumn ?? visualPointColumn(context, head);
    if (vim.visualToEol) {
      activeColumn = anchorColumn;
      for (let line = first; line <= last; line++) activeColumn = Math.max(activeColumn, visualPointColumn(context, context.lineEnd(line)) - 1);
    }
    const backwards = activeColumn < anchorColumn;
    if ((Math.abs(activeColumn - anchorColumn) + 1) * (last - first + 1) > vim.registers.maxCharacters) {
      throw new RangeError('Vim block selection exceeds the character budget');
    }
    return createBoxSelections(context.buffer, {
      anchorLine, activeLine, anchorColumn: anchorColumn + (backwards ? 1 : 0),
      activeColumn: activeColumn + (backwards ? 0 : 1), tabSize: context.editor.options?.tabSize ?? 4
    }).map(selection => ({ ...selection, head: selection.active,
      start: Math.min(selection.anchor, selection.active), end: Math.max(selection.anchor, selection.active), linewise: false }));
  }
  return [{ start: Math.min(anchor, head), end: adjacentCharacter(context, Math.max(anchor, head), 1), linewise: false }];
}

export function updateVisual(vim) {
  const ranges = visualRanges(vim);
  const primaryIndex = vim.mode === 'visual-block' ? ranges.findIndex(range => range.box.line === vim.context.position(vim.visualHead).line) : 0;
  vim.context.select(ranges.map(range => range.box ? range : { anchor: range.start, head: range.end }), true, primaryIndex);
  vim.notify();
}

export function toggleVisual(vim, mode) {
  if (vim.mode === mode) {
    vim.mode = 'normal';
    vim.context.goto(vim.visualHead);
  } else {
    if (!vim.mode.startsWith('visual')) {
      vim.visualAnchor = vim.context.selection.head;
      vim.visualHead = vim.visualAnchor;
    }
    vim.visualAnchorColumn = visualPointColumn(vim.context, vim.visualAnchor);
    vim.visualHeadColumn = visualPointColumn(vim.context, vim.visualHead);
    vim.visualToEol = false;
    vim.mode = mode;
    updateVisual(vim);
  }
  vim.notify();
}

/** Block h/l motions retain cell positions inside tabs; UTF-16 endpoints remain complete graphemes. */
export function blockHorizontalMotion(vim, key, count) {
  if (vim.mode !== 'visual-block' || !['h', 'l', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Space'].includes(key)) return null;
  const direction = ['h', 'ArrowLeft', 'Backspace'].includes(key) ? -1 : 1;
  const column = Math.max(0, vim.visualHeadColumn + count * direction);
  const line = vim.context.position(vim.visualHead).line;
  const point = offsetAtVisualColumn(vim.context.line(line), column, {
    tabSize: vim.context.editor.options?.tabSize ?? 4, segmenter: vim.context.graphemes
  });
  return { target: vim.context.lineStart(line) + point.offset, visualColumn: column, inclusive: true, linewise: false };
}

export function switchVisualCorner(vim, sameLine = false) {
  [vim.visualAnchorColumn, vim.visualHeadColumn] = [vim.visualHeadColumn, vim.visualAnchorColumn];
  if (!sameLine || vim.mode !== 'visual-block') [vim.visualAnchor, vim.visualHead] = [vim.visualHead, vim.visualAnchor];
  else {
    for (const [point, column] of [['visualAnchor', 'visualAnchorColumn'], ['visualHead', 'visualHeadColumn']]) {
      const line = vim.context.position(vim[point]).line;
      vim[point] = vim.context.lineStart(line) + offsetAtVisualColumn(vim.context.line(line), vim[column], {
        tabSize: vim.context.editor.options?.tabSize ?? 4, segmenter: vim.context.graphemes
      }).offset;
    }
  }
  updateVisual(vim);
}
