import {DrawingError} from '../drawing/commands.js';
import {selectionRectangles} from '../text/layout.js';
import {localBounds} from './shape-renderer.js';
import {inlineRuns, fontFamilySource} from '../text/rich-text.js';
export function layoutControlText(node, width, service, resolve, textScale = 1, forcedForeground = null) {
  const p = node.properties, {text, runs} = inlineRuns(node, resolve);
  const scale = p.IsTextScaleFactorEnabled === false ? 1 : textScale, fontSize = (p.FontSize ?? 14) * scale;
  return service.layout(text, {fontFamily: fontFamilySource(p, resolve), fontSize, fontWeight: p.FontWeight?.Weight ?? p.FontWeight ?? 400,
    fontStyle: ['normal', 'oblique', 'italic'][p.FontStyle ?? 0], width, wrapping: p.TextWrapping ?? 0,
    runs: runs.map(run => ({...run, style: {...run.style, fontSize: (run.style.fontSize ?? p.FontSize ?? 14) * scale,
      ...(forcedForeground ? {foreground: forcedForeground} : {})}})),
    alignment: ['left', 'center', 'right', 'justify', 'start'][p.TextAlignment ?? 0], direction: p.FlowDirection === 1 ? 'rtl' : 'auto',
    maxLines: p.MaxLines ?? 0, lineHeight: p.LineHeight ? p.LineHeight * scale : undefined, trimming: p.TextTrimming ?? 0,
    letterSpacing: (p.CharacterSpacing ?? 0) * fontSize / 1000,
    underline: p.TextDecorations === 1 || p.TextDecorations === 3, strikethrough: p.TextDecorations === 2 || p.TextDecorations === 3});
}
export function renderText(node, layout, context, resources, options = {}) {
  const service = options.textService ?? options.services?.text;
  if (!service) throw new DrawingError('SFRENDER085', 'Text rendering requires a configured shaping provider');
  const p = node.properties, rect = localBounds(layout);
  const run = layoutControlText(node, rect[2], service, options.resolve, options.textScale ?? 1, options.forcedForeground);
  if (p.SelectionLength > 0) for (const selection of selectionRectangles(run, p.SelectionStart ?? 0, (p.SelectionStart ?? 0) + p.SelectionLength)) {
    context.DrawRectangle(selection, p.SelectionHighlightColor ?? '#663399ff');
  }
  context.DrawGlyphRun(run, [0, 0], p.Foreground ?? '#000000');
  options.onTextLayout?.(node.id, run);
}
