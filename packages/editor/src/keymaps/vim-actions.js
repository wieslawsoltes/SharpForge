import { adjacentCharacter } from '../commands/movement.js';

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

export function applyOperator(vim, operation, ranges) {
  const context = vim.context;
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  if (operation !== 'y' && context.readOnly) { context.status('The document is read-only'); vim.resetPending(); return; }
  const linewise = ordered.every(range => range.linewise);
  if (['d', 'c', 'y'].includes(operation)) {
    let text = ordered.map(range => context.slice(range.start, range.end)).join(linewise ? '' : ordered.length > 1 ? '\n' : '');
    if (linewise && !text.endsWith('\n')) text += context.editor.options?.eol ?? '\n';
    vim.registers.write(vim.register, text, { linewise, yank: operation === 'y' });
  }
  vim.register = '"';
  if (operation === 'y') {
    context.goto(ordered[0].start);
    vim.mode = 'normal';
    vim.resetPending();
    vim.notify();
    return;
  }
  const size = context.editor.options?.indentSize ?? context.editor.options?.tabSize ?? 4;
  const edits = ordered.map(range => {
    const text = context.slice(range.start, range.end);
    const transforms = {
      d: () => '', c: () => range.linewise ? context.editor.options?.eol ?? '\n' : '',
      '>': () => text.replace(/^/gm, ' '.repeat(size)).replace(/ +$/, ''),
      '<': () => text.replace(new RegExp(`^(?: {1,${size}}|\\t)`, 'gm'), ''),
      gu: () => text.toLowerCase(), gU: () => text.toUpperCase(),
      'g~': () => [...text].map(character => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase()).join('')
    };
    const transform = transforms[operation];
    if (!transform) throw new Error(`Unsupported Vim operator '${operation}'`);
    return { start: range.start, deleteCount: range.end - range.start, text: transform() };
  });
  if (operation === 'c' && !vim.inUndoGroup) {
    context.editor.model?.beginUndoGroup?.('vim-change');
    vim.inUndoGroup = true;
  }
  context.apply(edits, [{ anchor: ordered[0].start, head: ordered[0].start }], { undoStop: operation !== 'c' });
  vim.mode = 'normal';
  vim.changed = true;
  vim.resetPending(false);
  if (operation === 'c') enterInsert(vim);
  else vim.finishChange();
  vim.notify();
}

export function visualRanges(vim) {
  const context = vim.context;
  const anchor = vim.visualAnchor;
  const head = vim.visualHead;
  const first = Math.min(context.position(anchor).line, context.position(head).line);
  const last = Math.max(context.position(anchor).line, context.position(head).line);
  vim.visualRange = { first, last };
  if (vim.mode === 'visual-line') return [{ start: context.lineStart(first), end: context.lineEnd(last, true), linewise: true }];
  if (vim.mode === 'visual-block') {
    const left = Math.min(context.position(anchor).character, context.position(head).character);
    const right = Math.max(context.position(anchor).character, context.position(head).character) + 1;
    const ranges = [];
    for (let line = first; line <= last; line++) ranges.push({
      start: context.offset({ line, character: left }), end: context.offset({ line, character: right }), linewise: false
    });
    return ranges;
  }
  return [{ start: Math.min(anchor, head), end: adjacentCharacter(context, Math.max(anchor, head), 1), linewise: false }];
}

export function updateVisual(vim) {
  const ranges = visualRanges(vim);
  vim.context.select(ranges.map(range => ({ anchor: range.start, head: range.end })));
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
    vim.mode = mode;
    updateVisual(vim);
  }
  vim.notify();
}

export function removeCharacters(vim, backwards = false, count = 1) {
  const context = vim.context;
  const point = context.selection.head;
  let end = point;
  for (let step = 0; step < count; step++) end = adjacentCharacter(context, end, backwards ? -1 : 1);
  applyOperator(vim, 'd', [{ start: Math.min(point, end), end: Math.max(point, end), linewise: false }]);
}

export async function pasteRegister(vim, before = false, count = 1) {
  const context = vim.context;
  if (context.readOnly) return;
  const uri = context.uri;
  const version = context.buffer?.version;
  const point = context.selection.head;
  const register = await vim.registers.read(vim.register);
  vim.register = '"';
  if (uri !== context.uri || version !== context.buffer?.version) throw new Error('Document changed while reading a register');
  if (register.text.length * count > vim.registers.maxCharacters) throw new RangeError('Register paste exceeds the character budget');
  const text = register.text.repeat(count);
  const position = context.position(point);
  let start = before ? point : adjacentCharacter(context, point, 1);
  let prefix = '';
  if (register.linewise) {
    start = before ? context.lineStart(position.line) : context.lineEnd(position.line, true);
    if (!before && position.line === context.lineCount - 1) prefix = context.editor.options?.eol ?? '\n';
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
