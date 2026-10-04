import {DrawingError} from '../drawing/commands.js';

/** Typed FontFamily descriptors and legacy string families share the same native shaping source. */
export function fontFamilySource(properties, resolve = value => value) {
  const selected = properties.FontFamilyObject ?? properties.FontFamily;
  const value = resolve(selected) ?? selected;
  const source = value?.properties?.Source ?? value?.Source ?? value;
  return typeof source === 'string' && source ? source : properties.FontFamily;
}

/** Convert WinUI inlines to contiguous style spans while preserving native shaping boundaries. */
export function inlineRuns(node, resolve = value => value) {
  const result = {text: '', runs: []}, active = new Set();
  let visited = 0;
  const visit = (input, inherited = {}, depth = 0) => {
    const current = resolve(input) ?? input;
    if (!current) return;
    if (active.has(current) || depth > 80 || ++visited > 100000) throw new DrawingError('SFRENDER082', 'Inline cycle or nesting budget exceeded');
    active.add(current);
    const p = current.properties ?? current, kind = (current.type ?? '').split('.').at(-1);
    const style = {...inherited};
    const fields = {FontFamily: 'fontFamily', FontSize: 'fontSize', FontWeight: 'fontWeight', Foreground: 'foreground'};
    for (const [property, key] of Object.entries(fields)) if (p[property] != null) {
      const value = resolve(p[property]) ?? p[property]; style[key] = value.properties ?? value;
    }
    if (p.FontFamilyObject != null || p.FontFamily != null) style.fontFamily = fontFamilySource(p, resolve);
    if (p.FontStyle != null) style.fontStyle = ['normal', 'oblique', 'italic'][p.FontStyle] ?? p.FontStyle;
    if (p.TextDecorations != null) { style.underline = Boolean(p.TextDecorations & 1); style.strikethrough = Boolean(p.TextDecorations & 2); }
    if (kind === 'Bold') style.fontWeight = 700;
    if (kind === 'Italic') style.fontStyle = 'italic';
    if (kind === 'Underline') style.underline = true;
    const append = text => {
      if (!text) return;
      if (result.text.length + text.length > 1000000) throw new DrawingError('SFRENDER082', 'Inline text budget exceeded');
      const start = result.text.length; result.text += text;
      result.runs.push({start, end: result.text.length, style: {...style}});
    };
    const children = current.collections?.Inlines ?? current.collections?.Blocks ?? p.Inlines ?? p.Blocks;
    if (kind === 'LineBreak') append('\n');
    else if (children?.length) {
      children.forEach((child, index) => {
        if (index && kind === 'RichTextBlock') append('\n');
        visit(child, style, depth + 1);
      });
    } else append(String(p.Text ?? ''));
    active.delete(current);
  };
  visit(node); return result;
}

/** Native Canvas shapes intact font runs; color spans clip their painted range without reshaping characters. */
export function paintTextLayout(context, run, {paint, dpr = 1, overrideColors = false} = {}) {
  if (run.options?.letterSpacing && !('letterSpacing' in context)) {
    throw new DrawingError('SFRENDER088', 'Character spacing requires native letter spacing');
  }
  if (!('wordSpacing' in context) && run.lines.some(line => line.fontRuns?.some(group => group.wordSpacing))) {
    throw new DrawingError('SFRENDER088', 'Justified text requires native word spacing');
  }
  context.save(); context.textBaseline = 'alphabetic';
  try {
    if ('letterSpacing' in context) context.letterSpacing = `${run.options?.letterSpacing ?? 0}px`;
    context.fontKerning = 'normal';
    for (const line of run.lines) {
      const groups = line.fontRuns?.length ? line.fontRuns : [{text: line.text, font: run.font, left: line.left,
        width: line.width, baseline: line.baseline, direction: line.direction, paints: [{style: run.options ?? {}, rects: null}]}];
      for (const group of groups) for (const span of group.paints) {
        context.save(); context.font = group.font; context.direction = group.direction;
        try {
          if ('wordSpacing' in context) context.wordSpacing = `${group.wordSpacing ?? 0}px`;
          context.textAlign = group.direction === 'rtl' ? 'right' : 'left';
          if (span.rects) {
            context.beginPath();
            for (const rect of span.rects) context.rect(rect[0], rect[1] - run.fontSize, rect[2], rect[3] + run.fontSize * 2);
            context.clip();
          }
          context.fillStyle = paint?.(overrideColors ? null : span.style.foreground) ?? '#000000';
          context.fillText(group.text, group.direction === 'rtl' ? group.left + group.width : group.left, group.baseline);
          const fontSize = span.style.fontSize ?? run.fontSize, thickness = Math.max(1 / dpr, fontSize / 16);
          if (span.style.underline) context.fillRect(group.left, group.baseline + run.descent / 2, group.width, thickness);
          if (span.style.strikethrough) context.fillRect(group.left, group.baseline - run.ascent / 3, group.width, thickness);
        } finally { context.restore(); }
      }
    }
  } finally { context.restore(); }
}
