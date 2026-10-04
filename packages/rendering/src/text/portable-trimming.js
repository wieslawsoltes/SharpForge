import {fitTextPrefix, sliceTextStyles} from './trimming.js';

/** Trim by re-shaping the entire candidate line, preserving contextual scripts and exact font/variation selection. */
export function trimPortableText(provider, run, sourceOptions) {
  const last = run.lines.at(-1);
  const width = sourceOptions.width;
  if (!last || !sourceOptions.trimming || !Number.isFinite(width) || !run.trimmed && last.width <= width) return run;
  const original = run.text.slice(last.start, last.visibleEnd);
  const parts = sliceTextStyles(sourceOptions.runs ?? [{start: 0, end: run.text.length, style: sourceOptions}], last.start, last.visibleEnd);
  const boundaries = provider.segment(original).map(cluster => cluster.end);
  const options = {...sourceOptions, width, maxLines: 0, trimming: 0, wrapping: 'nowrap', direction: last.direction,
    alignment: sourceOptions.alignment === 'justify' ? 'start' : sourceOptions.alignment};
  const candidates = new Map();
  const shape = text => {
    let shaped = candidates.get(text.length);
    if (!shaped) {
      shaped = provider.layoutCore(text, {...options, runs: sliceTextStyles(parts, 0, text.length - 1, 1)});
      candidates.set(text.length, shaped);
    }
    return shaped;
  };
  const fitted = fitTextPrefix(original, boundaries, width, text => shape(text).lines[0]?.width ?? 0,
    {word: sourceOptions.trimming === 2 || sourceOptions.trimming === 'word'});
  const replacement = shape(fitted.text);
  const visibleEnd = last.start + fitted.end;
  const lineIndex = run.lines.length - 1;
  const dy = last.top - replacement.lines[0].top;
  const remap = position => Math.min(visibleEnd, last.start + position);
  for (const glyph of replacement.glyphs) {
    glyph.start = remap(glyph.start);
    glyph.end = remap(glyph.end);
    glyph.cluster = remap(glyph.cluster);
    glyph.y += dy;
    glyph.line = lineIndex;
  }
  for (const cluster of replacement.clusters) {
    cluster.start = remap(cluster.start);
    cluster.end = remap(cluster.end);
    cluster.line = lineIndex;
    for (const rectangle of cluster.rects) rectangle[1] += dy;
  }
  for (const decoration of replacement.decorations) { decoration.rect[1] += dy; decoration.line = lineIndex; }
  const line = replacement.lines[0];
  for (const fontRun of line.fontRuns) { fontRun.start = remap(fontRun.start); fontRun.end = remap(fontRun.end); fontRun.baseline += dy; }
  line.top += dy;
  line.baseline += dy;
  line.start = last.start;
  line.end = last.end;
  line.visibleEnd = visibleEnd;
  run.lines[lineIndex] = line;
  run.glyphs = run.glyphs.filter(glyph => glyph.line < lineIndex).concat(replacement.glyphs);
  run.clusters = run.clusters.filter(cluster => cluster.line < lineIndex).concat(replacement.clusters);
  run.decorations = run.decorations.filter(decoration => decoration.line < lineIndex).concat(replacement.decorations);
  run.width = Math.min(width, run.lines.reduce((maximum, current) => Math.max(maximum, current.left + current.width), 0));
  run.height = line.top + line.height;
  run.trimmed = true;
  return run;
}
