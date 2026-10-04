import {DrawingError} from '../drawing/commands.js';

/** Find a fitting grapheme prefix with O(log n) native measurements, preserving UTF-16 boundaries. */
export function fitTextPrefix(text, boundaries, width, measure, {word = false, ellipsis = '\u2026'} = {}) {
  if (!Number.isFinite(width) || width < 0 || !Array.isArray(boundaries)) throw new DrawingError('SFRENDER082', 'Invalid text trimming bounds');
  let low = 0, high = boundaries.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2), end = boundaries[middle - 1];
    if (measure(text.slice(0, end) + ellipsis) <= width) low = middle;
    else high = middle - 1;
  }
  let end = low ? boundaries[low - 1] : 0;
  if (word && end < text.length) {
    const candidate = text.slice(0, end), boundary = candidate.search(/\s+\S*$/);
    if (boundary > 0) end = boundary;
  }
  return {end, text: text.slice(0, end) + ellipsis};
}

/** Slice style spans without introducing shaping breaks at color-only boundaries. */
export function sliceTextStyles(runs, start, end, suffixLength = 0) {
  const result = [];
  let lastStyle = {};
  for (const run of runs ?? []) {
    if (run.start <= end && run.end >= start) lastStyle = run.style;
    const left = Math.max(start, run.start), right = Math.min(end, run.end);
    if (right > left) result.push({start: left - start, end: right - start, style: run.style});
  }
  if (!result.length && end > start) result.push({start: 0, end: end - start, style: lastStyle});
  if (suffixLength) result.push({start: end - start, end: end - start + suffixLength, style: result.at(-1)?.style ?? lastStyle});
  return result;
}

/** Native DOM measures complete styled prefixes; the browser still owns shaping, bidi, fallback and kerning. */
export function trimNativeLine(document, host, line, options, fontCss) {
  const measure = document.createElement('div');
  Object.assign(measure.style, {position: 'absolute', width: 'max-content', whiteSpace: 'pre', margin: '0', padding: '0',
    border: '0', font: fontCss(options), letterSpacing: `${options.letterSpacing ?? 0}px`, direction: line.direction});
  host.append(measure);
  const original = line.text, runs = sliceTextStyles(options.runs ?? [{start: 0, end: line.end, style: options}], line.start, line.end);
  const measureText = text => {
    const end = text.length - 1, parts = sliceTextStyles(runs, 0, end, 1);
    measure.replaceChildren();
    for (const part of parts) {
      const span = document.createElement('span');
      span.style.font = fontCss({...options, ...part.style}); span.textContent = text.slice(part.start, part.end); measure.append(span);
    }
    return measure.getBoundingClientRect().width;
  };
  try {
    const boundaries = line.clusters.filter(cluster => cluster.end <= line.start + original.length).map(cluster => cluster.end - line.start);
    const result = fitTextPrefix(original, boundaries, options.width, measureText,
      {word: options.trimming === 2 || options.trimming === 'word'});
    return {...result, runs: sliceTextStyles(runs, 0, result.end, 1)};
  } finally { measure.remove(); }
}

/** Move the final shaped line into its retained paragraph slot, with ellipsis caret positions snapped to the visible end. */
export function placeTrimmedLine(shaped, original, visibleEnd, lineIndex) {
  const line = shaped.lines[0];
  if (!line) return {line: original, clusters: []};
  const offset = original.top - line.top;
  for (const cluster of shaped.clusters) {
    cluster.start = Math.min(visibleEnd, cluster.start + original.start);
    cluster.end = Math.min(visibleEnd, cluster.end + original.start);
    cluster.line = lineIndex;
    for (const rect of cluster.rects) rect[1] += offset;
  }
  for (const group of line.fontRuns ?? []) group.baseline += offset;
  line.top += offset; line.baseline += offset; line.start = original.start; line.end = original.end; line.visibleEnd = visibleEnd;
  return {line, clusters: shaped.clusters};
}
