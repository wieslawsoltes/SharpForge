import { GitError, checkCancelled, checkLimit } from './errors.js';
import { diffLines, splitLines } from './diff/lines.js';

/** Apply a selected subset of changed line operations without altering unselected index content. */
export function applySelectedLines(before, after, { selectedLines, selectedHunks, reverse = false, signal } = {}) {
  checkCancelled(signal);
  const changes = diffLines(before, after, { signal });
  const selected = selectedLines === undefined ? null : new Set(selectedLines);
  const hunkLines = selectedHunks ? new Set(selectedHunks.flatMap(hunk => hunk.lines.map(line => line.index))) : null;
  const output = [];
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const included = (!selected || selected.has(index)
      || selected.has(`${change.type === 'insert' ? 'new' : 'old'}:${change.type === 'insert' ? change.newLine : change.oldLine}`))
      && (!hunkLines || hunkLines.has(index));
    const keepDelete = reverse ? included : !included;
    const keepInsert = reverse ? !included : included;
    if (change.type === 'equal' || (change.type === 'delete' && keepDelete) || (change.type === 'insert' && keepInsert)) {
      output.push(change.line);
    }
  }
  return output.join('');
}

/** Parse unified hunks, preserving missing-newline markers and rejecting malformed counts. */
export function parsePatch(text) {
  checkLimit(text.length, 64 * 1024 * 1024, 'Patch bytes');
  const lines = splitLines(text);
  const hunks = [];
  let current = null;
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (header) {
      current = { oldStart: Number(header[1]), oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]), newLines: header[4] === undefined ? 1 : Number(header[4]), lines: [] };
      hunks.push(current);
    } else if (current && /^[ +-]/u.test(line)) {
      current.lines.push({ type: line[0] === '+' ? 'insert' : line[0] === '-' ? 'delete' : 'equal', line: line.slice(1) });
    } else if (current && line.startsWith('\\ No newline at end of file')) {
      if (!current.lines.length) throw new GitError('Corrupt', 'Patch newline marker has no preceding line');
      current.lines.at(-1).line = current.lines.at(-1).line.replace(/\n$/u, '');
    } else if (current && !line.startsWith('diff --git ')) throw new GitError('Corrupt', 'Malformed unified patch');
  }
  for (const hunk of hunks) {
    if (hunk.lines.filter(line => line.type !== 'insert').length !== hunk.oldLines
      || hunk.lines.filter(line => line.type !== 'delete').length !== hunk.newLines) {
      throw new GitError('Corrupt', 'Unified patch line counts do not match its header');
    }
  }
  return hunks;
}

/** Apply exact-context unified hunks; failure is detected before the caller persists a new blob. */
export function applyPatch(before, patch, { reverse = false, signal } = {}) {
  const hunks = typeof patch === 'string' ? parsePatch(patch) : patch;
  const input = splitLines(before);
  const output = [];
  let position = 0;
  for (const hunk of hunks) {
    checkCancelled(signal);
    const start = reverse ? hunk.newStart : hunk.oldStart;
    const count = reverse ? hunk.newLines : hunk.oldLines;
    const target = start - (count ? 1 : 0);
    if (target < position || target > input.length) throw new GitError('Conflict', 'Patch hunks overlap or exceed the input');
    for (const line of input.slice(position, target)) output.push(line);
    position = target;
    for (const operation of hunk.lines) {
      const type = reverse ? ({ insert: 'delete', delete: 'insert', equal: 'equal' })[operation.type] : operation.type;
      if (type !== 'insert') {
        if (input[position] !== operation.line) throw new GitError('Conflict', 'Patch context does not match', { line: position + 1 });
        position++;
      }
      if (type !== 'delete') output.push(operation.line);
    }
  }
  for (const line of input.slice(position)) output.push(line);
  return output.join('');
}
