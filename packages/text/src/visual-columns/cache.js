import { ColumnState, checkpointBefore } from './state.js';

export function columnOptions({ tabSize = 4, ambiguousWidth = 1 } = {}) {
  if (!Number.isInteger(tabSize) || tabSize < 1 || tabSize > 256) throw new RangeError('Tab size must be between 1 and 256');
  if (ambiguousWidth !== 1 && ambiguousWidth !== 2) throw new RangeError('Ambiguous width must be 1 or 2');
  return { tabSize, ambiguousWidth };
}

export function entryKey(start, options) { return `${start}:${options.tabSize}:${options.ambiguousWidth}`; }

export function createColumnEntry(snapshot, line, options, interval) {
  return {
    start: snapshot.lineStart(line), end: snapshot.lineEnd(line), options, stride: interval,
    checkpoints: [new ColumnState(options)], results: new Map(), valid: true
  };
}

/** Preserve unchanged lines and the exact pre-edit checkpoint on a changed line; offsets in each line stay relative. */
export function rebaseColumnEntries(entries, event, snapshot) {
  const nextEntries = new Map();
  for (const entry of entries.values()) {
    let shift = 0;
    let affected = Infinity;
    for (const change of event.changes) {
      if (change.end < entry.start) shift += change.text.length - (change.end - change.start);
      else if (change.start <= entry.end) {
        if (change.start <= entry.start) { entry.valid = false; break; }
        affected = Math.min(affected, change.start - entry.start);
      } else break;
    }
    if (!entry.valid) continue;
    const start = entry.start + shift;
    const line = snapshot.positionAt(start).line;
    if (snapshot.lineStart(line) !== start) { entry.valid = false; continue; }
    entry.start = start;
    entry.end = snapshot.lineEnd(line);
    if (affected !== Infinity) {
      // Rewind before a possible surrogate-pair edit seam as well as the unfinished grapheme's numeric state.
      const index = checkpointBefore(entry.checkpoints, Math.max(0, affected - 2));
      entry.checkpoints.length = index + 1;
      for (const offset of entry.results.keys()) if (offset >= affected) entry.results.delete(offset);
    }
    nextEntries.set(entryKey(start, entry.options), entry);
  }
  return nextEntries;
}

export function visualColumnError(code, message) {
  const error = new Error(message);
  error.name = code === 'VISUAL_COLUMN_CANCELLED' ? 'AbortError' : 'VisualColumnError';
  error.code = code;
  return error;
}

export function positiveLimit(name, value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`Invalid visual column ${name}`);
  return value;
}
