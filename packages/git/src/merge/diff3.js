import { diffLines, splitLines } from '../diff/lines.js';
import { isBinary } from '../eol.js';
import { GitError } from '../errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function edits(base, changed, options) {
  const result = [];
  let position = 0;
  let current = null;
  for (const operation of diffLines(base, changed, options)) {
    if (operation.type === 'equal') {
      current = null;
      position++;
      continue;
    }
    if (!current) result.push(current = { start: position, end: position, lines: [] });
    if (operation.type === 'delete') current.end = ++position;
    else current.lines.push(operation.line);
  }
  return result;
}

function applyRegion(base, start, end, changes) {
  const result = [];
  let position = start;
  for (const change of changes) {
    for (const line of base.slice(position, change.start)) result.push(line);
    for (const line of change.lines) result.push(line);
    position = change.end;
  }
  for (const line of base.slice(position, end)) result.push(line);
  return result;
}

function markerContent(lines) {
  const text = lines.join('');
  return text && !text.endsWith('\n') ? `${text}\n` : text;
}

function conflictText(base, ours, theirs, options) {
  const { style = 'merge', oursLabel = 'HEAD', baseLabel = 'base', theirsLabel = 'incoming', markerSize = 7 } = options;
  let prefix = '';
  let suffix = '';
  if (style === 'zdiff3') {
    let start = 0;
    while (start < Math.min(ours.length, theirs.length) && ours[start] === theirs[start]) start++;
    let end = 0;
    while (end < Math.min(ours.length, theirs.length) - start && ours.at(-end - 1) === theirs.at(-end - 1)) end++;
    prefix = ours.slice(0, start).join('');
    suffix = end ? ours.slice(-end).join('') : '';
    ours = ours.slice(start, ours.length - end);
    theirs = theirs.slice(start, theirs.length - end);
  }
  let text = prefix + `${'<'.repeat(markerSize)} ${oursLabel}\n${markerContent(ours)}`;
  if (style === 'diff3' || style === 'zdiff3') text += `${'|'.repeat(markerSize)} ${baseLabel}\n${markerContent(base)}`;
  text += `${'='.repeat(markerSize)}\n${markerContent(theirs)}${'>'.repeat(markerSize)} ${theirsLabel}\n`;
  return text + suffix;
}

/** Three-way text merge with bounded Myers edits and merge/diff3/zdiff3 conflict markers. */
export function mergeText(baseText, oursText, theirsText, options = {}) {
  if (!['merge', 'diff3', 'zdiff3'].includes(options.style ?? 'merge')) throw new GitError('Unsupported', 'Unknown conflict marker style');
  if (!Number.isInteger(options.markerSize ?? 7) || (options.markerSize ?? 7) < 1 || (options.markerSize ?? 7) > 128) {
    throw new GitError('Limit', 'Invalid conflict marker size');
  }
  if (oursText === theirsText) return { text: oursText, clean: true, conflicts: [] };
  if (oursText === baseText) return { text: theirsText, clean: true, conflicts: [] };
  if (theirsText === baseText) return { text: oursText, clean: true, conflicts: [] };
  const base = splitLines(baseText);
  const ours = edits(base, splitLines(oursText), options);
  const theirs = edits(base, splitLines(theirsText), options);
  const combined = [...ours.map(change => ({ ...change, side: 'ours' })), ...theirs.map(change => ({ ...change, side: 'theirs' }))];
  combined.sort((left, right) => left.start - right.start || left.end - right.end);
  const output = [];
  const conflicts = [];
  let position = 0;
  for (let index = 0; index < combined.length;) {
    const start = combined[index].start;
    let end = combined[index].end;
    const cluster = [combined[index++]];
    while (index < combined.length && combined[index].start <= end) {
      end = Math.max(end, combined[index].end);
      cluster.push(combined[index++]);
    }
    output.push(base.slice(position, start).join(''));
    const leftEdits = cluster.filter(change => change.side === 'ours');
    const rightEdits = cluster.filter(change => change.side === 'theirs');
    const left = applyRegion(base, start, end, leftEdits);
    const right = applyRegion(base, start, end, rightEdits);
    if (!rightEdits.length) output.push(left.join(''));
    else if (!leftEdits.length) output.push(right.join(''));
    else if (left.join('') === right.join('')) output.push(left.join(''));
    else if (options.driver === 'union') output.push(left.join('') + right.join(''));
    else {
      const original = base.slice(start, end);
      conflicts.push({ start, end, base: original, ours: left, theirs: right });
      output.push(conflictText(original, left, right, options));
    }
    position = end;
  }
  output.push(base.slice(position).join(''));
  return { text: output.join(''), clean: conflicts.length === 0, conflicts };
}

/** Merge byte blobs; binary conflicts retain ours and require explicit resolution. */
export function mergeFile(base, ours, theirs, options = {}) {
  if (options.driver === 'binary' || options.driver === false || isBinary(base) || isBinary(ours) || isBinary(theirs)) {
    const same = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);
    const data = same(ours, base) ? theirs : ours;
    const clean = same(ours, theirs) || same(ours, base) || same(theirs, base);
    return { data: data.slice(), clean, binary: true, conflicts: clean ? [] : [{ type: 'binary' }] };
  }
  const result = mergeText(decoder.decode(base), decoder.decode(ours), decoder.decode(theirs), options);
  return { ...result, data: encoder.encode(result.text), binary: false };
}

export const diff3 = mergeText;
