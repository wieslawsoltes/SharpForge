import { diffCharacters, diffLines } from './diff.js';
import { analyzeEol } from './eol.js';

function overlaps(first, second) {
  if (first.oldStart === first.oldEnd && second.oldStart === second.oldEnd) return first.oldStart === second.oldStart;
  return first.oldStart < second.oldEnd && second.oldStart < first.oldEnd;
}

function groupChanges(ours, theirs) {
  const entries = [
    ...ours.map(change => ({ ...change, side: 'ours' })), ...theirs.map(change => ({ ...change, side: 'theirs' }))
  ].sort((first, second) => first.oldStart - second.oldStart || first.oldEnd - second.oldEnd || first.side.localeCompare(second.side));
  const groups = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (!previous || !overlaps(previous, entry)) {
      groups.push({ oldStart: entry.oldStart, oldEnd: entry.oldEnd, entries: [entry] });
    } else { previous.oldEnd = Math.max(previous.oldEnd, entry.oldEnd); previous.entries.push(entry); }
  }
  return groups;
}

function regionText(base, variant, group, side) {
  const pieces = [];
  let offset = group.oldStart;
  for (const entry of group.entries) {
    if (entry.side !== side) continue;
    pieces.push(base.slice(offset, entry.oldStart), variant.slice(entry.newStart, entry.newEnd));
    offset = entry.oldEnd;
  }
  pieces.push(base.slice(offset, group.oldEnd));
  return pieces.join('');
}

function variantStart(group, changes, side) {
  let offset = group.oldStart;
  for (const change of changes) {
    if (change.oldEnd > group.oldStart) break;
    const belongs = change.oldStart === change.oldEnd && change.oldStart === group.oldStart
      && group.entries.some(entry => entry.side === side && entry.newStart === change.newStart && entry.newEnd === change.newEnd);
    if (!belongs) offset += change.newEnd - change.newStart - (change.oldEnd - change.oldStart);
  }
  return offset;
}

function conflictId(baseStart, baseEnd, base, ours, theirs) {
  let hash = 2166136261;
  for (const text of [base, '\0', ours, '\0', theirs]) {
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return `conflict-${baseStart.toString(36)}-${baseEnd.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function markerText(ours, theirs, eol, labels) {
  const terminated = text => !text || /[\r\n]$/.test(text) ? text : text + eol;
  return `<<<<<<< ${labels.ours}${eol}${terminated(ours)}=======${eol}${terminated(theirs)}>>>>>>> ${labels.theirs}${eol}`;
}

/** Three-way merge with deterministic overlap grouping and stable conflict identifiers. Inputs are never modified. */
export function merge3(base, ours, theirs, options = {}) {
  if (![base, ours, theirs].every(text => typeof text === 'string')) throw new TypeError('Merge inputs must be strings');
  const algorithm = options.granularity === 'character' ? diffCharacters : diffLines;
  const first = algorithm(base, ours, { ...options, refine: false });
  const second = algorithm(base, theirs, { ...options, refine: false });
  const groups = groupChanges(first.changes, second.changes);
  const eol = options.eol ?? analyzeEol(base).dominantEol;
  const labels = { ours: options.oursLabel ?? 'ours', theirs: options.theirsLabel ?? 'theirs' };
  if (Object.values(labels).some(label => /[\r\n]/.test(label))) throw new RangeError('Conflict labels must fit on one line');
  const pieces = [];
  const conflicts = [];
  let offset = 0;
  let outputLength = 0;
  for (const group of groups) {
    const unchanged = base.slice(offset, group.oldStart);
    pieces.push(unchanged);
    outputLength += unchanged.length;
    const baseText = base.slice(group.oldStart, group.oldEnd);
    const oursText = regionText(base, ours, group, 'ours');
    const theirsText = regionText(base, theirs, group, 'theirs');
    let replacement;
    if (oursText === theirsText || theirsText === baseText) replacement = oursText;
    else if (oursText === baseText) replacement = theirsText;
    else {
      replacement = markerText(oursText, theirsText, eol, labels);
      const oursStart = variantStart(group, first.changes, 'ours');
      const theirsStart = variantStart(group, second.changes, 'theirs');
      conflicts.push({
        id: conflictId(group.oldStart, group.oldEnd, baseText, oursText, theirsText),
        start: outputLength, end: outputLength + replacement.length,
        baseStart: group.oldStart, baseEnd: group.oldEnd,
        oursStart, oursEnd: oursStart + oursText.length, theirsStart, theirsEnd: theirsStart + theirsText.length,
        base: baseText, ours: oursText, theirs: theirsText
      });
    }
    pieces.push(replacement);
    outputLength += replacement.length;
    offset = group.oldEnd;
  }
  pieces.push(base.slice(offset));
  return {
    text: pieces.join(''), conflicts, clean: conflicts.length === 0,
    timedOut: first.timedOut || second.timedOut, truncated: first.truncated || second.truncated,
    changes: { ours: first.changes, theirs: second.changes }
  };
}
