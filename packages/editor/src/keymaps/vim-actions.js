import { visualColumnAt } from '@sharpforge/text';
import { boxSelectionEdits, boxSelectionText, createBoxSelections } from '../commands/box-selection.js';
import { pasteBox } from '../commands/multi-clipboard.js';
import { adjacentCharacter } from '../commands/movement.js';
import { normalPoint } from './vim-motions.js';
import { visualRanges } from './vim-visual.js';
import { shiftBlockEdits } from './vim-block-editing.js';

export function enterInsert(vim, mode = 'insert') {
  if (vim.context.readOnly) { vim.context.status('The document is read-only'); return; }
  vim.mode = mode;
  if (!vim.inUndoGroup) vim.context.editor.model?.beginUndoGroup?.('vim-insert');
  vim.inUndoGroup = true;
  vim.notify();
}

export function leaveInsert(vim) {
  if (vim.inUndoGroup) vim.context.editor.model?.endUndoGroup?.();
  vim.inUndoGroup = false;
  vim.mode = 'normal';
  const point = vim.context.selection.head;
  const position = vim.context.position(point);
  vim.context.goto(Math.max(vim.context.lineStart(position.line), adjacentCharacter(vim.context, point, -1)));
  vim.finishChange();
  vim.resetPending();
  vim.notify();
}

export function applyOperator(vim, operation, ranges, count = 1) {
  const context = vim.context;
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  if (operation !== 'y' && context.readOnly) { context.status('The document is read-only'); vim.resetPending(); return; }
  const linewise = ordered.every(range => range.linewise);
  const blockwise = ordered.every(range => range.box);
  if (['d', 'c', 'y'].includes(operation)) {
    const fragments = ordered.map(range => blockwise ? boxSelectionText(context.buffer, range) : context.slice(range.start, range.end));
    let text = fragments.join(linewise ? '' : ordered.length > 1 ? '\n' : '');
    if (linewise && !/[\r\n]$/.test(text)) text += context.eol;
    const capture = context.capture();
    const block = blockwise ? { fragments, width: ordered[0].box.endColumn - ordered[0].box.startColumn } : undefined;
    const written = vim.registers.write(vim.register, text, { linewise, block, yank: operation === 'y' });
    if (written?.then) return written.then(() => {
      context.assertCurrent(capture, 'writing a register');
      return commitOperator(vim, operation, ordered, count);
    });
  }
  return commitOperator(vim, operation, ordered, count);
}

function commitOperator(vim, operation, ordered, count) {
  const context = vim.context;
  vim.register = '"';
  if (operation === 'y') {
    context.goto(ordered[0].start);
    vim.mode = 'normal';
    vim.resetPending();
    vim.notify();
    return;
  }
  const size = (context.editor.options?.indentSize ?? context.editor.options?.tabSize ?? 4) * count;
  const blockwise = ordered.every(range => range.box);
  let edits = ordered.map(range => {
    if (operation === 'd' && range.linewise && range.end === context.length && range.start > 0) {
      range = { ...range, start: context.lineEnd(context.position(range.start).line - 1) };
    }
    const text = blockwise ? boxSelectionText(context.buffer, range, { padVirtualSpace: false }) : context.slice(range.start, range.end);
    const transforms = {
      d: () => '', c: () => range.linewise && /[\r\n]$/.test(text) ? context.eol : '',
      '>': () => text.replace(/^/gm, ' '.repeat(size)).replace(/ +$/, ''),
      '<': () => text.replace(new RegExp(`^(?: {1,${size}}|\\t)`, 'gm'), ''),
      gu: () => text.toLowerCase(), gU: () => text.toUpperCase(),
      'g~': () => [...text].map(character => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase()).join('')
    };
    const transform = transforms[operation];
    if (!transform) throw new Error(`Unsupported Vim operator '${operation}'`);
    return { start: range.start, deleteCount: range.end - range.start, text: transform() };
  });
  if (blockwise) edits = ['>', '<'].includes(operation) ? shiftBlockEdits(context, ordered, operation === '>' ? 1 : -1, count) :
    boxSelectionEdits(context.buffer, ordered, edits.map(edit => edit.text), { padVirtualSpace: false });
  if (!edits.length) { vim.resetPending(); return false; }
  if (operation === 'c' && !vim.inUndoGroup) {
    context.editor.model?.beginUndoGroup?.('vim-change');
    vim.inUndoGroup = true;
  }
  const start = edits[0].start;
  let delta = 0;
  const carets = operation === 'c' && blockwise ? edits.map((edit, index) => {
    const head = edit.start + delta + edit.caretInText;
    const line = context.line(ordered[index].box.line);
    const column = visualColumnAt(line, line.length, { tabSize: ordered[index].box.tabSize });
    const activeVirtualSpace = Math.max(0, ordered[index].box.startColumn - column);
    delta += edit.text.length - (edit.end - edit.start);
    return { anchor: head, head, activeVirtualSpace };
  }) : [{ anchor: start, head: start }];
  context.apply(edits, carets, { undoStop: operation !== 'c', primaryIndex: 0 });
  if (operation !== 'c') context.goto(normalPoint(context, Math.min(start, context.length)));
  vim.mode = 'normal';
  vim.changed = true;
  vim.resetPending(false);
  if (operation === 'c') enterInsert(vim);
  else vim.finishChange();
  vim.notify();
}

/** I retains short rows, while A pads to the block boundary, matching Vim's separate insertion contracts. */
export function insertVisualBlock(vim, append = false) {
  const context = vim.context;
  if (context.readOnly) { context.status('The document is read-only'); return false; }
  const ranges = visualRanges(vim);
  const selections = ranges.flatMap(range => {
    const line = range.box.line;
    const width = visualColumnAt(context.line(line), context.line(line).length, { tabSize: range.box.tabSize });
    const column = append ? vim.visualToEol ? width : range.box.endColumn : range.box.startColumn;
    if (!append && width < column) return [];
    return createBoxSelections(context.buffer, {
      anchorLine: line, activeLine: line, anchorColumn: column, activeColumn: column, tabSize: range.box.tabSize
    });
  });
  if (!selections.length) return false;
  context.select(selections, true, 0);
  enterInsert(vim);
  return true;
}

export function removeCharacters(vim, backwards = false, count = 1) {
  const context = vim.context;
  const point = context.selection.head;
  let end = point;
  const line = context.position(point).line;
  const limit = backwards ? context.lineStart(line) : context.lineEnd(line);
  for (let step = 0; step < count && end !== limit; step++) {
    const next = adjacentCharacter(context, end, backwards ? -1 : 1);
    end = backwards ? Math.max(limit, next) : Math.min(limit, next);
  }
  if (end === point) { vim.resetPending(); return; }
  return applyOperator(vim, 'd', [{ start: Math.min(point, end), end: Math.max(point, end), linewise: false }]);
}

export async function pasteRegister(vim, before = false, count = 1) {
  const context = vim.context;
  if (context.readOnly) return;
  const capture = context.capture();
  const point = context.selection.head;
  const register = await vim.registers.read(vim.register);
  vim.register = '"';
  context.assertCurrent(capture, 'reading a register');
  if (context.readOnly) return false;
  if (register.text.length * count > vim.registers.maxCharacters) throw new RangeError('Register paste exceeds the character budget');
  const text = register.text.repeat(count);
  if (vim.mode.startsWith('visual')) {
    const ranges = visualRanges(vim);
    const blockwise = ranges.every(range => range.box);
    const replacements = ranges.map((_, index) => register.block ?
      (register.block.fragments[index % register.block.fragments.length] ?? '').repeat(count) : text);
    const edits = blockwise ? boxSelectionEdits(context.buffer, ranges, replacements) :
      ranges.map(range => ({ start: range.start, deleteCount: range.end - range.start, text }));
    const head = ranges[0].start;
    context.apply(edits, [{ anchor: head, head }]);
    vim.mode = 'normal';
    vim.changed = true;
    vim.finishChange();
    vim.notify();
    return true;
  }
  const position = context.position(point);
  let start = before ? point : Math.min(context.lineEnd(position.line), adjacentCharacter(context, point, 1));
  let prefix = '';
  if (register.linewise) {
    start = before ? context.lineStart(position.line) : context.lineEnd(position.line, true);
    if (!before && position.line === context.lineCount - 1) prefix = context.eol;
  }
  if (register.block) {
    context.goto(start);
    const fragments = register.block.fragments.map(fragment => fragment.repeat(count));
    pasteBox(context.selectionModel, fragments, {
      tabSize: context.editor.options?.tabSize ?? 4, source: 'vim-paste', maxInsertedCharacters: vim.registers.maxCharacters
    });
    context.goto(start);
    vim.changed = true;
    vim.finishChange();
    return true;
  }
  context.apply([{ start, deleteCount: 0, text: prefix + text }], [{ anchor: start + prefix.length, head: start + prefix.length }]);
  vim.changed = true;
  vim.finishChange();
}

export function joinLines(vim, count = 2, keepSpace = false) {
  const context = vim.context;
  const first = context.position(context.selection.head).line;
  const last = Math.min(context.lineCount - 1, first + Math.max(2, count) - 1);
  const start = context.lineStart(first);
  const lines = [];
  for (let line = first; line <= last; line++) lines.push(context.line(line));
  const text = keepSpace ? lines.join('') : lines.map((line, index) => index ? line.trimStart() : line.trimEnd()).join(' ');
  context.apply([{ start, deleteCount: context.lineEnd(last) - start, text }]);
  vim.changed = true;
  vim.finishChange();
}
