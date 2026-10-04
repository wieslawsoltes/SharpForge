import {throwIfWorkspaceAborted} from './content-hash.js';

const equalBytes = (left, right) => left instanceof Uint8Array && right instanceof Uint8Array &&
  left.length === right.length && left.every((value, index) => value === right[index]);

function trimEdit(base, start, end, text) {
  while (start < end && text && base[start] === text[0]) { start++; text = text.slice(1); }
  while (end > start && text && base[end - 1] === text.at(-1)) { end--; text = text.slice(0, -1); }
  return start === end && !text ? null : {start, end, text};
}

/** Line alignment with bounded work, followed by exact character trimming at each edit boundary. */
function difference(base, modified, {maxCells, signal}) {
  const original = base.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const updated = modified.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if ((original.length + 1) * (updated.length + 1) > maxCells) {
    return [trimEdit(base, 0, base.length, modified)].filter(Boolean);
  }
  const width = updated.length + 1;
  const table = new Uint32Array((original.length + 1) * width);
  for (let row = original.length - 1; row >= 0; row--) {
    throwIfWorkspaceAborted(signal);
    for (let column = updated.length - 1; column >= 0; column--) {
      table[row * width + column] = original[row] === updated[column] ? table[(row + 1) * width + column + 1] + 1 :
        Math.max(table[(row + 1) * width + column], table[row * width + column + 1]);
    }
  }
  const edits = [];
  let row = 0;
  let column = 0;
  let offset = 0;
  while (row < original.length || column < updated.length) {
    if (row < original.length && column < updated.length && original[row] === updated[column]) {
      offset += original[row++].length;
      column++;
      continue;
    }
    const start = offset;
    const chunks = [];
    while (row < original.length || column < updated.length) {
      if (row < original.length && column < updated.length && original[row] === updated[column]) break;
      if (column < updated.length && (row === original.length ||
          table[row * width + column + 1] >= table[(row + 1) * width + column])) chunks.push(updated[column++]);
      else offset += original[row++].length;
    }
    const edit = trimEdit(base, start, offset, chunks.join(''));
    if (edit) edits.push(edit);
  }
  return edits;
}

function overlaps(left, right) {
  if (left.start === left.end && right.start === right.end) return left.start === right.start;
  if (left.start === left.end) return left.start > right.start && left.start < right.end;
  if (right.start === right.end) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

/** Merge disjoint changes to a shared baseline; overlapping edits remain explicit conflicts, with all three texts preserved. */
export function mergeWorkspaceText(base, mine, theirs, {maxLength = 4 * 1024 * 1024, maxCells = 2_000_000, signal} = {}) {
  throwIfWorkspaceAborted(signal);
  if (![base, mine, theirs].every(value => typeof value === 'string')) throw new TypeError('Three text versions are required');
  if ([base, mine, theirs].some(value => value.length > maxLength)) throw new RangeError('SFW1201: Merge text size limit exceeded');
  if (mine === theirs || theirs === base) return {status: 'merged', text: mine, conflicts: []};
  if (mine === base) return {status: 'merged', text: theirs, conflicts: []};
  const local = difference(base, mine, {maxCells, signal});
  const remote = difference(base, theirs, {maxCells, signal});
  const edits = [...local];
  const conflicts = [];
  let cursor = 0;
  for (const incoming of remote) {
    while (cursor < local.length && local[cursor].end < incoming.start) cursor++;
    let duplicate = false;
    let conflict = false;
    for (let index = cursor; index < local.length && local[index].start <= incoming.end; index++) {
      const own = local[index];
      if (own.start === incoming.start && own.end === incoming.end && own.text === incoming.text) duplicate = true;
      else if (overlaps(own, incoming)) {
        conflict = true;
        conflicts.push({start: Math.min(own.start, incoming.start), end: Math.max(own.end, incoming.end), mine: own, theirs: incoming});
      }
    }
    if (!duplicate && !conflict) edits.push(incoming);
  }
  if (conflicts.length) return {status: 'conflict', base, mine, theirs, conflicts};
  edits.sort((left, right) => left.start - right.start || left.end - right.end);
  let position = 0;
  const result = [];
  for (const edit of edits) {
    result.push(base.slice(position, edit.start), edit.text);
    position = edit.end;
  }
  result.push(base.slice(position));
  return {status: 'merged', text: result.join(''), conflicts: []};
}

/** No resolution is implicit. Binary files permit keep-mine or take-theirs, and never a fabricated textual merge. */
export function reconcileWorkspaceFile({path, base, mine, theirs, choice}, options = {}) {
  throwIfWorkspaceAborted(options.signal);
  if (!['keep-mine', 'take-theirs', 'merge'].includes(choice)) {
    return {path, status: 'choice-required', choices: ['keep-mine', 'take-theirs', 'merge'], base, mine, theirs};
  }
  if (choice !== 'merge') return {path, status: 'resolved', choice, content: structuredClone(choice === 'keep-mine' ? mine : theirs)};
  if ([base, mine, theirs].every(value => typeof value === 'string')) {
    const result = mergeWorkspaceText(base, mine, theirs, options);
    return {...result, path, choice, content: result.text};
  }
  if (equalBytes(mine, theirs) || equalBytes(base, theirs)) return {path, status: 'resolved', choice, content: mine.slice()};
  if (equalBytes(base, mine)) return {path, status: 'resolved', choice, content: theirs.slice()};
  return {path, status: 'conflict', code: 'SFW1202', message: 'Binary changes require keep-mine or take-theirs', base, mine, theirs};
}
