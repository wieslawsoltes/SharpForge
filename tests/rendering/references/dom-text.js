import {referenceCanvas, canvasReferencePacket} from './canvas-primitives.js';

export function textOptions(definition) {
  return {fontSize: definition.fontSize ?? 16, fontFamily: definition.fontFamily ?? 'sans-serif',
    fontWeight: definition.fontWeight ?? 400, fontStyle: definition.fontStyle ?? 'normal',
    width: definition.textWidth ?? definition.width - 8, lineHeight: definition.lineHeight ?? 24,
    wrapping: definition.wrapping ?? 'wrap', trimming: definition.trimming ?? 0,
    maxLines: definition.maxLines ?? 0, direction: definition.direction ?? 'auto',
    alignment: definition.alignment ?? 'left', letterSpacing: definition.letterSpacing ?? 0};
}

function font(options) {
  return `${options.fontStyle} ${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
}

function nativeElement(document, options) {
  const element = document.createElement('div');
  element.dir = options.direction;
  Object.assign(element.style, {position: 'absolute', top: '0', left: '-10000px', margin: '0', border: '0', padding: '0',
    width: options.width + 'px', font: font(options), lineHeight: options.lineHeight + 'px',
    letterSpacing: options.letterSpacing + 'px', whiteSpace: options.wrapping === 'nowrap' ? 'pre' : 'pre-wrap',
    overflowWrap: options.wrapping === 'wholewords' ? 'normal' : 'anywhere', textAlign: options.alignment,
    unicodeBidi: options.direction === 'auto' ? 'plaintext' : 'normal', fontKerning: 'normal'});
  document.body.append(element);
  return element;
}

function measuredPrefix(document, text, options) {
  const element = nativeElement(document, {...options, wrapping: 'nowrap'});
  element.style.width = 'max-content';
  const boundaries = [0];
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  for (const part of segmenter.segment(text)) boundaries.push(part.index + part.segment.length);
  let chosen = 0;
  let width = 0;
  try {
    // Deliberately use a bounded linear search, independently of the production binary-search trimmer.
    for (const end of boundaries) {
      element.textContent = text.slice(0, end) + '\u2026';
      const measured = element.getBoundingClientRect().width;
      if (end === 0 || measured <= options.width) {
        chosen = end;
        width = measured;
      }
    }
    if (options.trimming === 'word' && chosen < text.length) {
      const words = new Intl.Segmenter(undefined, {granularity: 'word'});
      const matches = [...words.segment(text)].filter(part => part.isWordLike && part.index + part.segment.length <= chosen);
      if (matches.length) chosen = matches.at(-1).index + matches.at(-1).segment.length;
      element.textContent = text.slice(0, chosen) + '\u2026';
      width = element.getBoundingClientRect().width;
    }
    return {text: text.slice(0, chosen) + '\u2026', end: chosen, width};
  } finally {
    element.remove();
  }
}

/** A separate DOM text node supplies line boundaries and ellipsis width through native Range/layout APIs. */
export function measureDomText(document, text, options) {
  if (text.length > 4096) throw new RangeError('DOM text oracle fixture character budget exceeded');
  const element = nativeElement(document, options);
  const node = document.createTextNode(text);
  element.append(node);
  try {
    const root = element.getBoundingClientRect();
    const range = document.createRange();
    const rows = new Map();
    let offset = 0;
    for (const character of text) {
      range.setStart(node, offset);
      range.setEnd(node, offset + character.length);
      const boxes = [...range.getClientRects()];
      const box = boxes[0];
      if (box) {
        const top = Math.round((box.top - root.top) * 64) / 64;
        const row = rows.get(top) ?? {start: offset, end: offset, top, left: Infinity, right: -Infinity};
        row.end = offset + character.length;
        for (const rect of boxes) {
          row.left = Math.min(row.left, rect.left - root.left);
          row.right = Math.max(row.right, rect.right - root.left);
        }
        rows.set(top, row);
      }
      offset += character.length;
    }
    const lines = [...rows.values()].sort((left, right) => left.top - right.top).map(row => ({...row,
      text: text.slice(row.start, row.end).replace(/[\r\n]+$/, ''), width: row.right - row.left}));
    const visible = options.maxLines ? lines.slice(0, options.maxLines) : lines;
    const last = visible.at(-1);
    let trimmed = visible.length < lines.length;
    if (last && options.trimming && (trimmed || last.width > options.width)) {
      const measured = measuredPrefix(document, last.text, options);
      Object.assign(last, {text: measured.text, visibleEnd: last.start + measured.end, width: measured.width});
      if (options.alignment === 'center') last.left = (options.width - last.width) / 2;
      else if (options.alignment === 'right') last.left = options.width - last.width;
      else last.left = 0;
      trimmed = true;
    }
    return {lines: visible, allLineCount: lines.length, trimmed,
      direction: document.defaultView.getComputedStyle(element).direction,
      reference: 'Independent DOM Range and element width measurements'};
  } finally {
    element.remove();
  }
}

export function textReference(document, definition, text, options, layout) {
  const {canvas, painter} = referenceCanvas(document, definition);
  try {
    painter.font = font(options);
    painter.textBaseline = 'alphabetic';
    painter.direction = layout.direction;
    painter.textAlign = 'left';
    painter.fillStyle = definition.foreground ?? '#202020';
    if ('letterSpacing' in painter) painter.letterSpacing = options.letterSpacing + 'px';
    const metrics = painter.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    if (!Number.isFinite(ascent)) throw new Error('DOM text reference lacks native ascent metrics');
    for (const line of layout.lines) painter.fillText(line.text, 4 + line.left, 2 + line.top + ascent);
    return canvasReferencePacket(canvas, {kind: 'canvas2d-dom-text', provider: 'browser-native-dom',
      glyphAccess: 'opaque-native-runs', textLength: text.length, lineCount: layout.lines.length});
  } finally {
    canvas.width = canvas.height = 0;
  }
}
