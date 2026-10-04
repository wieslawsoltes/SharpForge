import { boxSelectionEdits } from '../commands/box-selection.js';
import { applyOperator, joinLines } from './vim-actions.js';
import { visualRanges, switchVisualCorner } from './vim-visual.js';
import { normalPoint } from './vim-motions.js';

function wholeLines(vim) {
  const ranges = visualRanges(vim);
  const first = vim.context.position(ranges[0].start).line;
  const last = vim.context.position(ranges.at(-1).end > ranges.at(-1).start ? ranges.at(-1).end - 1 : ranges.at(-1).end).line;
  return [{ start: vim.context.lineStart(first), end: vim.context.lineEnd(last, true), linewise: true }];
}

function operationRanges(vim, toEnd = false) {
  if (vim.mode !== 'visual-block') return wholeLines(vim);
  if (toEnd) vim.visualToEol = true;
  return visualRanges(vim);
}

/** Visual aliases operate on the active range; they never fall through to an unrelated normal-mode edit. */
export function visualCommandHandlers(vim) {
  if (!vim.mode.startsWith('visual')) return {};
  return {
    x: () => applyOperator(vim, 'd', visualRanges(vim)),
    s: () => applyOperator(vim, 'c', visualRanges(vim)),
    X: () => applyOperator(vim, 'd', operationRanges(vim)),
    D: () => applyOperator(vim, 'd', operationRanges(vim, true)),
    S: () => applyOperator(vim, 'c', operationRanges(vim)),
    R: () => applyOperator(vim, 'c', operationRanges(vim)),
    C: () => applyOperator(vim, 'c', operationRanges(vim, true)),
    Y: () => applyOperator(vim, 'y', operationRanges(vim)),
    u: () => applyOperator(vim, 'gu', visualRanges(vim)),
    U: () => applyOperator(vim, 'gU', visualRanges(vim)),
    '~': () => applyOperator(vim, 'g~', visualRanges(vim)),
    r: () => { vim.pending = { kind: 'replace', visual: true }; },
    o: () => switchVisualCorner(vim), O: () => switchVisualCorner(vim, true),
    J: () => {
      const [range] = wholeLines(vim);
      const first = vim.context.position(range.start).line;
      const last = vim.context.position(Math.max(range.start, range.end - 1)).line;
      vim.context.goto(range.start);
      vim.mode = 'normal';
      return joinLines(vim, last - first + 1);
    }
  };
}

/** Replace complete graphemes, or selected screen cells in a block; line terminators remain intact. */
export function replaceVisual(vim, key) {
  const context = vim.context;
  if (context.readOnly) { context.status('The document is read-only'); vim.resetPending(); return false; }
  const character = key === 'Space' ? ' ' : key;
  if ([...character].length !== 1) throw new Error('Visual replace requires one character');
  const ranges = visualRanges(vim);
  let characters = 0;
  const replacements = ranges.map(range => {
    if (range.box) {
      characters += range.box.endColumn - range.box.startColumn;
      if (characters * character.length > vim.registers.maxCharacters) throw new RangeError('Visual replace exceeds the character budget');
      return character.repeat(range.box.endColumn - range.box.startColumn);
    }
    return [...context.graphemes.segments(context.slice(range.start, range.end))]
      .map(item => /[\r\n]/u.test(item.segment) ? item.segment : character).join('');
  });
  const edits = ranges.every(range => range.box) ? boxSelectionEdits(context.buffer, ranges, replacements) :
    ranges.map((range, index) => ({ start: range.start, end: range.end, text: replacements[index] }));
  const point = edits[0].start;
  context.apply(edits, [{ anchor: point, head: point }], { primaryIndex: 0 });
  context.goto(normalPoint(context, point));
  vim.mode = 'normal';
  vim.changed = true;
  vim.finishChange();
  vim.resetPending();
  vim.notify();
  return true;
}
