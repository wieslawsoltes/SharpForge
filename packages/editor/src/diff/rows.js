import {diffLines} from '@sharpforge/text';

function segmentLines(text, start, end) {
  if (start === end) return [];
  const lines = [];
  let cursor = start;
  while (cursor < end) {
    let finish = cursor;
    while (finish < end && text[finish] !== '\r' && text[finish] !== '\n') finish++;
    let next = finish;
    if (next < end && text[next] === '\r') next++;
    if (next < end && text[next] === '\n') next++;
    lines.push({text: text.slice(cursor, finish), start: cursor, end: next});
    cursor = next;
  }
  return lines;
}

/** Produces one aligned logical row per line; padding rows preserve synchronized vertical scrolling. */
export function buildDiffRows(original, modified, result = diffLines(original, modified)) {
  const rows = [];
  const hunks = [];
  let oldCursor = 0;
  let newCursor = 0;
  let oldLine = 1;
  let newLine = 1;
  const append = (oldEnd, newEnd, hunk = null) => {
    const left = segmentLines(original, oldCursor, oldEnd);
    const right = segmentLines(modified, newCursor, newEnd);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const old = left[index] ? {...left[index], line: oldLine++} : null;
      const current = right[index] ? {...right[index], line: newLine++} : null;
      rows.push({original: old, modified: current, hunk, kind: hunk === null ? 'equal' : old && current ? 'changed' : old ? 'deleted' : 'inserted'});
    }
    oldCursor = oldEnd;
    newCursor = newEnd;
  };
  for (const [index, change] of result.changes.entries()) {
    append(change.oldStart, change.newStart);
    const row = rows.length;
    append(change.oldEnd, change.newEnd, index);
    hunks.push({...change, row, rows: rows.length - row});
  }
  append(original.length, modified.length);
  if (!rows.length) rows.push({original: {text: '', line: 1, start: 0, end: 0}, modified: {text: '', line: 1, start: 0, end: 0}, kind: 'equal'});
  return {rows, hunks, timedOut: result.timedOut, truncated: result.truncated};
}

export function inlineDiffRows(aligned) {
  const rows = [];
  for (const row of aligned.rows) {
    if (row.kind === 'equal') rows.push({...row.modified, kind: 'equal', hunk: null});
    else {
      if (row.original) rows.push({...row.original, kind: 'deleted', hunk: row.hunk});
      if (row.modified) rows.push({...row.modified, kind: 'inserted', hunk: row.hunk});
    }
  }
  return rows;
}
