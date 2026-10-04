import {DrawingError} from '../drawing/commands.js';
import {hardLineBreak, shapeTextRange} from './text-items.js';
import {estimateClusterWidths} from './shaped-clusters.js';
import {lineOpportunities} from './line-opportunities.js';

function paragraphs(prepared) {
  const result = [];
  let start = 0;
  let first = 0;
  let bidiIndex = 0;
  for (let index = 0; index <= prepared.clusters.length; index++) {
    const cluster = prepared.clusters[index];
    if (cluster && !hardLineBreak(cluster)) continue;
    const end = cluster?.start ?? prepared.text.length;
    while (prepared.bidi.paragraphs[bidiIndex + 1]?.start <= start) bidiIndex++;
    result.push({start, end, breakEnd: cluster?.end ?? end, first, last: index,
      direction: prepared.bidi.paragraphs[bidiIndex]?.level & 1 ? 'rtl' : 'ltr'});
    start = cluster?.end ?? end;
    first = index + 1;
  }
  return result;
}

function candidateBreak(prefix, start, width) {
  let low = start + 1;
  let high = prefix.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (prefix[middle] - prefix[start] <= width) low = middle;
    else high = middle - 1;
  }
  return low;
}

function legalBreak(units, opportunities, start, candidate, wholeWords) {
  for (let index = candidate; index > start; index--) if (opportunities.has(units[index - 1].end)) return index;
  if (!wholeWords) return candidate;
  for (let index = candidate + 1; index <= units.length; index++) if (opportunities.has(units[index - 1].end)) return index;
  return units.length;
}

function fitCandidate(units, opportunities, breaks, start, candidate, measure, options) {
  const shape = measure(candidate);
  let chosen = {end: candidate, shaped: shape};
  if (shape.width > options.width) {
    if (options.wrapping === 'wholewords' || candidate === start + 1) return chosen;
    let low = start + 1;
    let high = candidate - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (measure(middle).width <= options.width) low = middle;
      else high = middle - 1;
    }
    const end = legalBreak(units, opportunities, start, low, false);
    chosen = {end, shaped: measure(end)};
  }
  // Contextual shaping can shorten a candidate relative to the paragraph estimate.
  let low = 0, high = breaks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (breaks[middle] <= chosen.end) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < breaks.length; index++) {
    const next = breaks[index], shaped = measure(next);
    if (shaped.width > options.width) break;
    chosen = {end: next, shaped};
  }
  return chosen;
}

/** Shape complete lines after Unicode break selection. Work is bounded by text/glyph/line budgets.
 * Emergency wrapping never divides a Unicode grapheme and reshapes ligatures at the chosen boundary.
 */
export function shapeLines(prepared, shaper, {maxLines = 4096, maxLineWork = 4000000, signal} = {}) {
  const options = prepared.options;
  const opportunities = lineOpportunities(prepared.text, {maxSteps: maxLineWork, signal});
  const output = [];
  const visibleLimit = options.maxLines || maxLines;
  let hidden = false;
  for (const paragraph of paragraphs(prepared)) {
    signal?.throwIfAborted();
    if (output.length >= visibleLimit) { hidden = true; break; }
    const units = prepared.clusters.slice(paragraph.first, paragraph.last);
    const breaks = [];
    units.forEach((unit, index) => { if (opportunities.has(unit.end)) breaks.push(index + 1); });
    let full = shapeTextRange(prepared, shaper, paragraph.start, paragraph.end, signal);
    if (!units.length || options.wrapping === 'nowrap' || full.width <= options.width) {
      output.push({...paragraph, shaped: full, paragraphEnd: true});
      continue;
    }
    const prefix = estimateClusterWidths(units, full);
    full = null;
    let first = 0;
    while (first < units.length) {
      if (output.length >= visibleLimit) { hidden = true; break; }
      const cache = new Map();
      const measure = end => {
        if (!cache.has(end)) cache.set(end, shapeTextRange(prepared, shaper, units[first].start, units[end - 1].end, signal));
        return cache.get(end);
      };
      let candidate = candidateBreak(prefix, first, options.width);
      candidate = legalBreak(units, opportunities, first, candidate, options.wrapping === 'wholewords');
      const fitted = fitCandidate(units, opportunities, breaks, first, candidate, measure, options);
      const end = units[fitted.end - 1].end;
      output.push({start: units[first].start, end, breakEnd: end === paragraph.end ? paragraph.breakEnd : end,
        direction: paragraph.direction, shaped: fitted.shaped, paragraphEnd: end === paragraph.end});
      first = fitted.end;
    }
    if (hidden) break;
  }
  if (hidden && !options.maxLines) throw new DrawingError('SFRENDER082', 'Text line count exceeds provider budget');
  return {lines: output, hidden};
}
