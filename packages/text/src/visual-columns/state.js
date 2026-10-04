import { GraphemeState } from '../grapheme/state.js';
import { codePointColumnMetrics } from '../columns.js';

/** A checkpoint retains numeric cluster state, never the text of an unfinished grapheme. */
export class ColumnState {
  constructor(options, state = {}) {
    this.options = options;
    this.grapheme = new GraphemeState(state.grapheme);
    this.offset = state.offset ?? 0;
    this.column = state.column ?? 0;
    this.baseWidth = state.baseWidth ?? 0;
    this.emoji = state.emoji ?? false;
    this.width = state.width ?? 0;
  }
  consume(code, metrics) {
    if (this.grapheme.consume(code)) {
      this.column += this.width;
      this.baseWidth = 0;
      this.emoji = false;
    }
    if (code === 9) {
      this.width = this.options.tabSize - this.column % this.options.tabSize;
      return;
    }
    this.baseWidth = Math.max(this.baseWidth, metrics & 3);
    this.emoji ||= !!(metrics & 4);
    this.width = this.baseWidth && this.emoji ? 2 : this.baseWidth;
  }
  asciiRun(length) {
    const width = this.options.ambiguousWidth;
    this.consume(97, width);
    if (length > 1) {
      this.column += this.width + (length - 2) * width;
      this.baseWidth = width;
      this.emoji = false;
      this.width = width;
      this.grapheme.consume(97);
    }
    this.offset += length;
  }
  clone() { return new ColumnState(this.options, this); }
}

export function codePointAt(snapshot, offset, end) {
  if (offset >= end) return -1;
  const high = snapshot.charCodeAt(offset);
  if (high < 0xd800 || high > 0xdbff || offset + 1 >= end) return high;
  const low = snapshot.charCodeAt(offset + 1);
  return low >= 0xdc00 && low <= 0xdfff ? 0x10000 + ((high - 0xd800) << 10) + low - 0xdc00 : high;
}

export function scanColumnChunk(snapshot, entry, state, target, chunkSize, metricsCache) {
  const start = entry.start + state.offset;
  const lineEnd = entry.end;
  let end = Math.min(entry.start + target, start + chunkSize);
  const previous = snapshot.charCodeAt(end - 1);
  const next = end < lineEnd ? snapshot.charCodeAt(end) : -1;
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end++;
  const text = snapshot.getText(start, end);
  for (let offset = 0; offset < text.length;) {
    const code = text.codePointAt(offset);
    if (code >= 32 && code <= 126) {
      let runEnd = offset + 1;
      while (runEnd < text.length && text.charCodeAt(runEnd) >= 32 && text.charCodeAt(runEnd) <= 126) runEnd++;
      state.asciiRun(runEnd - offset);
      offset = runEnd;
      continue;
    }
    const key = code * 2 + state.options.ambiguousWidth - 1;
    let metrics = metricsCache.get(key);
    if (metrics === undefined) {
      metrics = codePointColumnMetrics(code, state.options.ambiguousWidth);
      if (metricsCache.size >= 1024) metricsCache.delete(metricsCache.keys().next().value);
      metricsCache.set(key, metrics);
    }
    state.consume(code, metrics);
    const length = code > 0xffff ? 2 : 1;
    offset += length;
    state.offset += length;
  }
  return text.length;
}

export function columnResult(snapshot, entry, state, target) {
  if (state.offset > target) return state.column;
  const next = codePointAt(snapshot, entry.start + state.offset, entry.end);
  return next === -1 || state.grapheme.breaksBefore(next) ? state.column + state.width : state.column;
}

export function checkpointBefore(checkpoints, offset) {
  let low = 0;
  let high = checkpoints.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (checkpoints[middle].offset <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
