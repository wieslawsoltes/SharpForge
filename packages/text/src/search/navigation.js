import {SearchBudget} from './errors.js';
import {LiteralMatcher} from './literal.js';
import {wholeWord} from './whole-word.js';

function captureSource(source) {
  source = source?.snapshot?.() ?? source;
  if (typeof source === 'string') source = {text: source, length: source.length};
  if (!source) throw new TypeError('Search requires a source');
  const indexed = typeof source.getText === 'function';
  const text = indexed ? null : source.text;
  const length = source.length ?? text?.length;
  if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('Search requires a source with a length');
  const read = indexed ? (start, end) => source.getText(start, end) :
    typeof text === 'string' ? (start, end) => text.slice(start, end) : null;
  if (!read) throw new TypeError('Search requires indexed source text');
  return {
    uri: source.uri, version: source.version, length,
    read(start, end) {
      const text = read(start, end);
      if (typeof text !== 'string' || text.length !== end - start) throw new Error('Source changed while searching');
      return text;
    }
  };
}

function exclusions(ranges, length) {
  if (!Array.isArray(ranges) || ranges.length > 10_000) throw new RangeError('Search exclusions must contain at most 10000 ranges');
  const sorted = ranges.map(({start, end}) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > length) {
      throw new RangeError('Invalid search exclusion range');
    }
    return {start, end};
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return match => {
    let low = 0;
    let high = merged.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (merged[middle].end <= match.start) low = middle + 1;
      else high = middle;
    }
    return low < merged.length && merged[low].start < match.end;
  };
}

function betweenSurrogates(source, offset) {
  if (offset <= 0 || offset >= source.length) return false;
  const pair = source.read(offset - 1, offset + 1);
  return pair.charCodeAt(0) >= 0xd800 && pair.charCodeAt(0) <= 0xdbff
    && pair.charCodeAt(1) >= 0xdc00 && pair.charCodeAt(1) <= 0xdfff;
}

function phases(source, query, origin, direction, wrap) {
  const floor = offset => betweenSurrogates(source, offset) ? offset - 1 : offset;
  const ceil = offset => betweenSurrogates(source, offset) ? offset + 1 : offset;
  // A wrapped match may cross the origin; retain enough scalars to complete it on that pass.
  const maximumWidth = Array.from(query).length * 2;
  if (direction > 0) return [
    {start: ceil(origin), end: source.length, wrapped: false},
    ...(wrap && origin > 0 ? [{start: 0, end: ceil(Math.min(source.length, origin + maximumWidth)), wrapped: true}] : [])
  ];
  return [
    {start: 0, end: floor(origin), wrapped: false},
    ...(wrap && origin < source.length ? [{start: floor(Math.max(0, origin - maximumWidth)), end: source.length, wrapped: true}] : [])
  ];
}

function* chunks(source, phase, direction, size, budget) {
  let cursor = direction > 0 ? phase.start : phase.end;
  while (direction > 0 ? cursor < phase.end : cursor > phase.start) {
    budget.check();
    let boundary = direction > 0 ? Math.min(phase.end, cursor + size) : Math.max(phase.start, cursor - size);
    if (betweenSurrogates(source, boundary)) boundary += direction;
    const start = Math.min(cursor, boundary);
    const end = Math.max(cursor, boundary);
    yield {start, text: source.read(start, end)};
    cursor = boundary;
  }
}

function* searchSteps(value, query, options) {
  if (typeof query !== 'string' || query.length > 1024) throw new RangeError('Search text must be a string of at most 1024 characters');
  const source = captureSource(value);
  const direction = options.direction ?? 1;
  const origin = options.origin ?? (direction > 0 ? 0 : source.length);
  const wrap = options.wrap ?? true;
  const size = options.chunkSize ?? 16_384;
  if (direction !== 1 && direction !== -1) throw new RangeError('Search direction must be 1 or -1');
  if (!Number.isSafeInteger(origin) || origin < 0 || origin > source.length) throw new RangeError('Invalid search origin');
  if (typeof wrap !== 'boolean') throw new TypeError('Search wrap must be boolean');
  if (!Number.isInteger(size) || size < 256 || size > 262_144) throw new RangeError('Invalid search chunk size');
  const budget = new SearchBudget(options);
  const excluded = exclusions(options.excludeRanges ?? [], source.length);
  budget.check();
  if (!query) return {match: null, wrapped: false};
  for (const phase of phases(source, query, origin, direction, wrap)) {
    const matcher = new LiteralMatcher(query, options, budget, {direction, overlapping: true});
    for (const chunk of chunks(source, phase, direction, size, budget)) {
      for (const match of matcher.matches(chunk.text, chunk.start)) {
        if (excluded(match)) continue;
        const beforeOrigin = direction > 0 ? match.start < origin : match.end > origin;
        if (beforeOrigin !== phase.wrapped) continue;
        if (options.wholeWord) {
          const start = Math.max(0, match.start - 2);
          const text = source.read(start, Math.min(source.length, match.end + 2));
          if (!wholeWord(text, {start: match.start - start, end: match.end - start})) continue;
        }
        budget.check();
        return {
          match: {uri: source.uri, version: source.version, start: match.start, end: match.end,
            text: source.read(match.start, match.end)},
          wrapped: phase.wrapped
        };
      }
      budget.check();
      yield;
    }
  }
  return {match: null, wrapped: false};
}

/**
 * Find one literal match from a UTF-16 origin, with at most one wrap. Forward matches start at/after the origin;
 * reverse matches end at/before it. Snapshot reads, scalar KMP work and excluded selections are bounded.
 */
export function findLiteralMatch(source, query, options = {}) {
  const search = searchSteps(source, query, options);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

function scheduler(yieldControl) {
  if (yieldControl !== undefined) {
    if (typeof yieldControl !== 'function') throw new TypeError('Search yieldControl must be a function');
    return {yield: yieldControl, dispose() {}};
  }
  if (typeof MessageChannel !== 'function') {
    return {yield: () => new Promise(resolve => setTimeout(resolve, 0)), dispose() {}};
  }
  const channel = new MessageChannel();
  let resume;
  channel.port1.onmessage = () => {
    const next = resume;
    resume = null;
    next?.();
  };
  return {
    yield: () => new Promise(resolve => {
      resume = resolve;
      channel.port2.postMessage(0);
    }),
    dispose() {
      channel.port1.close();
      channel.port2.close();
    }
  };
}

/** Cooperative single-match navigation; defaults bound the whole search to one billion steps and thirty seconds. */
export async function findLiteralMatchAsync(source, query, options = {}) {
  const search = searchSteps(source, query, {maxSteps: 1_000_000_000, timeLimitMs: 30_000, ...options});
  const timing = scheduler(options.yieldControl);
  try {
    for (;;) {
      const step = search.next();
      if (step.done) return step.value;
      await timing.yield();
    }
  } finally {
    search.return();
    timing.dispose();
  }
}
