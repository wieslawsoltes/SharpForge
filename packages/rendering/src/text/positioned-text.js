import {visualTextItems} from './bidi.js';
import {shapedClusters} from './shaped-clusters.js';
import {unicodeTextVersions} from './unicode.js';

export function textStyleData(style) {
  const result = {};
  for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'language', 'features', 'variations',
    'letterSpacing', 'tabSize', 'underline', 'strikethrough', 'foreground']) if (style[name] !== undefined) result[name] = style[name];
  return result;
}

function lineOffset(options, direction, width) {
  if (!Number.isFinite(options.width)) return 0;
  const alignment = options.alignment === 'start' ? direction === 'rtl' ? 'right' : 'left'
    : options.alignment === 'end' ? direction === 'rtl' ? 'left' : 'right' : options.alignment;
  const free = Math.max(0, options.width - width);
  return alignment === 'right' ? free : alignment === 'center' ? free / 2 : 0;
}

function justification(prepared, specification) {
  if (prepared.options.alignment !== 'justify' || specification.paragraphEnd || !Number.isFinite(prepared.options.width)) return 0;
  const content = prepared.text.slice(specification.start, specification.end).replace(/ +$/, '');
  let spaces = 0;
  for (const character of content) if (character === ' ') spaces++;
  return spaces ? Math.max(0, prepared.options.width - specification.shaped.width) / spaces : 0;
}

function addDecoration(decorations, group, rectangle, baseline, line, kind) {
  const metrics = group.font.face.data.metrics;
  const scale = group.style.fontSize / group.font.unitsPerEm;
  const position = kind === 'underline' ? -metrics.underlinePosition : -metrics.strikePosition;
  const thickness = Math.max(1 / 64, (kind === 'underline' ? metrics.underlineThickness : metrics.strikeThickness) * scale);
  const rect = [rectangle[0], baseline + position * scale, rectangle[2], thickness];
  const previous = decorations.at(-1);
  if (previous && previous.kind === kind && previous.line === line && previous.foreground === group.style.foreground
    && Math.abs(previous.rect[1] - rect[1]) < 1e-6 && Math.abs(previous.rect[3] - rect[3]) < 1e-6
    && Math.abs(previous.rect[0] + previous.rect[2] - rect[0]) < 1e-6) previous.rect[2] += rect[2];
  else decorations.push({rect, foreground: group.style.foreground, line, kind});
}

function positionedLine(prepared, specification, state, defaultMetrics) {
  const options = prepared.options;
  const shaped = specification.shaped;
  const ascent = shaped.ascent || defaultMetrics.ascent;
  const descent = shaped.descent || defaultMetrics.descent;
  const height = options.lineHeight || Math.max(1 / 64, ascent + descent + (shaped.lineGap || defaultMetrics.lineGap));
  const baseline = state.top + ascent + (height - ascent - descent) / 2;
  const extra = justification(prepared, specification);
  const line = {start: specification.start, end: specification.breakEnd, visibleEnd: specification.end,
    top: state.top, height, baseline, ascent, descent, direction: specification.direction,
    text: prepared.text.slice(specification.start, specification.end), left: lineOffset(options, specification.direction, shaped.width),
    width: shaped.width, fontRuns: [], visualClusters: []};
  const visual = visualTextItems(prepared.bidi, shaped.items, specification.start, specification.end);
  const trimmedEnd = specification.start + line.text.replace(/ +$/, '').length;
  let x = line.left;
  for (const item of visual) {
    let spacing = 0;
    const groups = shapedClusters(item);
    for (const group of groups) {
      const stretch = extra && group.start < trimmedEnd ? extra * [...prepared.text.slice(group.start, group.end)].filter(char => char === ' ').length : 0;
      const rectangle = [x + group.advanceStart + spacing, state.top, group.width + stretch, height];
      const cluster = {start: group.start, end: group.end, text: prepared.text.slice(group.start, group.end),
        rtl: item.rtl, rects: [rectangle], line: state.lines.length, fontId: item.font.id, style: textStyleData(group.style)};
      state.clusters.push(cluster);
      line.visualClusters.push(cluster);
      for (const glyph of group.glyphs) state.glyphs.push({...glyph, start: group.start, end: group.end,
        x: x + glyph.x + spacing, y: baseline + glyph.y, foreground: group.style.foreground, line: state.lines.length});
      if (group.style.underline) addDecoration(state.decorations, group, rectangle, baseline, state.lines.length, 'underline');
      if (group.style.strikethrough) addDecoration(state.decorations, group, rectangle, baseline, state.lines.length, 'strikethrough');
      spacing += stretch;
    }
    line.fontRuns.push({start: item.start, end: item.end, fontId: item.font.id, fontSize: item.style.fontSize,
      left: x, width: item.width + spacing, baseline, direction: item.rtl ? 'rtl' : 'ltr'});
    x += item.width + spacing + item.style.letterSpacing;
  }
  if (visual.length) x -= visual.at(-1).style.letterSpacing;
  line.width = Math.max(0, x - line.left);
  if (specification.breakEnd > specification.end) state.clusters.push({start: specification.end, end: specification.breakEnd,
    text: prepared.text.slice(specification.end, specification.breakEnd), rtl: specification.direction === 'rtl',
    rects: [[specification.direction === 'rtl' ? line.left : x, state.top, 0, height]], line: state.lines.length});
  state.lines.push(line);
  state.top += height;
}

/** Produce data-only positioned glyphs and logical cluster rectangles from actual HarfBuzz output. */
export function positionText(prepared, shaped, {defaultMetrics, providerVersion, fontVersion}) {
  const state = {lines: [], glyphs: [], clusters: [], decorations: [], top: 0};
  for (const specification of shaped.lines) positionedLine(prepared, specification, state, defaultMetrics);
  const width = state.lines.reduce((maximum, line) => Math.max(maximum, line.left + line.width), 0);
  const options = prepared.options;
  return {kind: 'glyphRun', text: prepared.text, fontSize: options.fontSize, font: `${options.fontSize}px ${options.fontFamily}`,
    lineHeight: options.lineHeight || state.lines[0]?.height || options.fontSize,
    ascent: state.lines[0]?.ascent ?? defaultMetrics.ascent, descent: state.lines[0]?.descent ?? defaultMetrics.descent,
    width: Math.min(options.width, width), height: state.top, lines: state.lines, glyphs: state.glyphs,
    clusters: state.clusters.sort((a, b) => a.start - b.start), decorations: state.decorations,
    levels: Array.from(prepared.bidi.levels), trimmed: shaped.hidden,
    provider: 'harfbuzz', providerVersion, unicodeVersions: unicodeTextVersions,
    glyphAccess: 'numeric-glyphs', clusterAccess: 'harfbuzz', version: fontVersion,
    options: {...textStyleData(options), width: Number.isFinite(options.width) ? options.width : width,
      wrapping: options.wrapping, alignment: options.alignment, direction: options.direction, lineHeight: options.lineHeight,
      maxLines: options.maxLines, trimming: options.trimming ?? 0}};
}

/** Include glyph overhangs and decorations in raster bounds without changing their advance-based caret rectangles. */
export function portableInkBounds(run, glyphBounds) {
  let left = 0;
  let top = 0;
  let right = run.width;
  let bottom = run.height;
  for (const glyph of run.glyphs) {
    const bounds = glyphBounds(glyph);
    left = Math.min(left, glyph.x + bounds.x);
    top = Math.min(top, glyph.y + bounds.y);
    right = Math.max(right, glyph.x + bounds.x + bounds.width);
    bottom = Math.max(bottom, glyph.y + bounds.y + bounds.height);
  }
  for (const {rect} of run.decorations) {
    left = Math.min(left, rect[0]);
    top = Math.min(top, rect[1]);
    right = Math.max(right, rect[0] + rect[2]);
    bottom = Math.max(bottom, rect[1] + rect[3]);
  }
  return [left, top, right - left, bottom - top];
}
