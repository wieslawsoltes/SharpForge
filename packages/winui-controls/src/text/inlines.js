import { registerFamily, createPart, stateFor, controlName } from '../policy/events.js';
import { RichTextDocument } from './rich-document.js';
import { ControlError } from '../policy/events.js';
import { typographyFeatures as mappedTypographyFeatures, fontFamilySource } from './typography.js';
import { markRichTextSource, flowRichText } from './rich-overflow.js';

const inlineTags = Object.freeze({ Run: 'span', Span: 'span', Bold: 'strong', Italic: 'em', Underline: 'u',
  LineBreak: 'br', Hyperlink: 'a', InlineUIContainer: 'span', Paragraph: 'p' });
const typographyFeatures = Object.freeze({ StandardLigatures: 'liga', ContextualLigatures: 'clig', DiscretionaryLigatures: 'dlig',
  HistoricalLigatures: 'hlig', ContextualAlternates: 'calt', Kerning: 'kern', SlashedZero: 'zero', MathematicalGreek: 'mgrk',
  CaseSensitiveForms: 'case', CapitalSpacing: 'cpsp', StylisticSet1: 'ss01', StylisticSet2: 'ss02' });

export function applyTypography(element, properties) {
  element.style.fontFamily = fontFamilySource(properties.FontFamilyObject ?? properties.FontFamily);
  element.style.fontWeight = String(properties.FontWeight?.Weight ?? properties.FontWeight ?? 'normal');
  element.style.fontStyle = properties.FontStyle === 1 ? 'oblique' : properties.FontStyle === 2 ? 'italic' : 'normal';
  element.style.letterSpacing = properties.CharacterSpacing ? properties.CharacterSpacing / 1000 + 'em' : '';
  element.style.lineHeight = properties.LineHeight > 0 ? properties.LineHeight + 'px' : '';
  const features = mappedTypographyFeatures(properties);
  for (const [property, tag] of Object.entries(typographyFeatures)) {
    const value = properties['Typography.' + property] ?? properties[property];
    if (value !== undefined) features.push(`"${tag}" ${value ? 1 : 0}`);
  }
  element.style.fontFeatureSettings = features.join(', ');
  element.style.textDecoration = properties.TextDecorations === 1 ? 'underline' : properties.TextDecorations === 2 ? 'line-through' : '';
  if (Number.isFinite(properties.FontSize) && properties.FontSize > 0) element.style.fontSize = properties.FontSize + 'px';
  const brush = properties.Foreground;
  const color = brush?.Color ?? brush;
  if (typeof color === 'string') element.style.color = color;
  else if (color && ['R', 'G', 'B'].every(key => Number.isFinite(color[key]))) {
    element.style.color = `rgba(${color.R},${color.G},${color.B},${(color.A ?? 255) / 255})`;
  }
}

function resolvedTypography(context, properties) {
  const result = { ...properties };
  for (const name of ['FontFamilyObject', 'FontFamily', 'FontWeight', 'Foreground']) {
    const reference = properties[name];
    if (reference?.$ref) result[name] = context.nodes.get(reference.$ref)?.properties ?? reference;
  }
  return result;
}

function renderInline(context, value, visited = new Set()) {
  if (value == null) return context.document.createTextNode('');
  if (!value.$ref) return context.document.createTextNode(String(value));
  if (visited.has(value.$ref) || visited.size > 1024) throw new ControlError('SFUI1640', 'Inline graph is cyclic or too deep');
  const node = context.nodes.get(value.$ref);
  if (!node) return context.document.createTextNode('');
  visited.add(value.$ref);
  const kind = controlName(node);
  const element = context.document.createElement(inlineTags[kind] ?? 'span');
  applyTypography(element, resolvedTypography(context, node.properties));
  if (node.properties.FontWeight == null) element.style.fontWeight = kind === 'Bold' ? 'bold' : '';
  if (!node.properties.FontStyle) element.style.fontStyle = kind === 'Italic' ? 'italic' : '';
  if (!node.properties.FontFamily || node.properties.FontFamily === 'Segoe UI') element.style.fontFamily = 'inherit';
  if (kind === 'Paragraph') {
    const margin = node.properties.Margin;
    element.style.margin = margin ? `${margin.Top ?? 0}px ${margin.Right ?? 0}px ${margin.Bottom ?? 0}px ${margin.Left ?? 0}px` : '0';
    element.style.textIndent = (node.properties.TextIndent ?? 0) + 'px';
    element.style.textAlign = ['left', 'center', 'right', 'justify', 'start'][node.properties.TextAlignment ?? 0];
  }
  if (kind === 'Run') element.textContent = node.properties.Text ?? '';
  else if (kind === 'InlineUIContainer') {
    element.dataset.inlineUiContainer = '';
    context.content(element, node.properties.Child);
  }
  else if (kind !== 'LineBreak') {
    const children = node.collections.Inlines ?? [];
    for (const child of children) element.append(renderInline(context, child, visited));
    if (!children.length) element.textContent = String(node.properties.Text ?? '');
  }
  if (kind === 'Hyperlink') {
    element.dataset.hyperlinkId = node.id;
    element.setAttribute('role', 'link');
    element.tabIndex = 0;
  }
  visited.delete(value.$ref);
  return element;
}

function renderText(context, node, element) {
  const properties = node.properties;
  applyTypography(element, resolvedTypography(context, properties));
  const values = node.collections.Inlines ?? node.collections.Blocks;
  if (values?.length) context.ordered(element, values.map(value => renderInline(context, value)));
  else context.content(element, properties.Text);
  element.style.whiteSpace = properties.TextWrapping === 0 ? 'pre' : 'pre-wrap';
  element.style.overflowWrap = properties.TextWrapping === 0 ? 'normal' : 'anywhere';
  element.style.textAlign = ['left', 'center', 'right', 'justify', 'start'][properties.TextAlignment ?? 0];
  element.style.userSelect = properties.IsTextSelectionEnabled === false ? 'none' : 'text';
  element.style.overflow = properties.TextTrimming || properties.MaxLines > 0 ? 'hidden' : '';
  element.style.textOverflow = properties.TextTrimming ? 'ellipsis' : '';
  element.style.webkitLineClamp = properties.MaxLines > 0 ? String(properties.MaxLines) : '';
  element.style.webkitBoxOrient = properties.MaxLines > 0 ? 'vertical' : '';
  element.style.display = properties.MaxLines > 0 ? '-webkit-box' : '';
}

function textLayout(context, node, element) {
  flowRichText(context, node);
  const trimmed = !!(node.properties.TextTrimming || node.properties.MaxLines > 0)
    && (element.scrollWidth > element.clientWidth + 0.5 || element.scrollHeight > element.clientHeight + 0.5);
  if (node.properties.IsTextTrimmed === trimmed) return;
  node.properties.IsTextTrimmed = trimmed;
  context.emit(node, 'IsTextTrimmedChanged', { IsTextTrimmed: trimmed });
}

function selectDisplayText(context, node, element) {
  const ownerId = context.getState(node).richOverflowOwner;
  const owner = ownerId ? context.nodes.get(ownerId) ?? node : node;
  if (owner.properties.IsTextSelectionEnabled === false) return false;
  const selection = context.document.getSelection?.();
  const roots = context.getState(owner).richOverflowNodes?.map(id => context.elements.get(id)).filter(Boolean) ?? [element];
  const selected = selection?.rangeCount && roots.some(root => root.contains(selection.anchorNode))
    && roots.some(root => root.contains(selection.focusNode)) ? selection.toString() : '';
  if (owner.properties.SelectedText === selected) return false;
  owner.properties.SelectedText = selected;
  context.emit(owner, 'SelectionChanged', { SelectedText: selected });
  return true;
}

function richState(context, node) {
  return stateFor(context, node, 'rich-document', () => {
    const model = new RichTextDocument(node.properties.Text ?? '');
    model.on('TextChanged', () => {
      node.properties.Text = model.text;
      node.properties.RtfText = model.getText('rtf');
      model.sceneRtf = node.properties.RtfText;
      context.emit(node, 'TextChanged', { Text: model.text, RtfText: node.properties.RtfText, value: model.text });
    });
    model.on('SelectionChanged', args => context.emit(node, 'SelectionChanged', args));
    return model;
  });
}

function syncRichSelection(context, node, element) {
  const selection = context.document.getSelection?.();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return false;
  const range = selection.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const model = richState(context, node);
  const start = Math.min(model.length, before.toString().length);
  const length = Math.min(model.length - start, range.toString().length);
  if (model.selection.start !== start || model.selection.length !== length) model.select(start, length);
  return true;
}

function selectRichDom(context, node, element, start, length) {
  const model = richState(context, node);
  model.select(start, length);
  const walker = context.document.createTreeWalker(element, 4);
  const range = context.document.createRange();
  let offset = 0;
  let first = null;
  let last = null;
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (!first && start <= offset + text.length) first = { node: text, offset: start - offset };
    if (start + length <= offset + text.length) {
      last = { node: text, offset: start + length - offset };
      break;
    }
    offset += text.length;
  }
  if (!first || !last) return;
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  const selection = context.document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function renderRichDocument(document, element, rich) {
  const children = rich.runs.map(run => {
    const span = document.createElement('span');
    span.textContent = run.text;
    const format = run.format;
    Object.assign(span.style, { fontWeight: format.bold ? 'bold' : '', fontStyle: format.italic ? 'italic' : '',
      textDecoration: format.underline ? 'underline' : '', fontSize: format.size ? format.size + 'px' : '',
      color: /^#[0-9a-f]{6}$/i.test(format.foreground ?? '') ? format.foreground : '', textAlign: format.alignment ?? '' });
    return span;
  });
  element.replaceChildren(...children);
}

export function registerInlineRenderers(registry) {
  registerFamily(registry, ['TextBlock', 'RichTextBlock', 'RichTextBlockOverflow'], {
    create: context => context.document.createElement('div'),
    render(context, node, element) {
      if (controlName(node) === 'RichTextBlockOverflow' && context.getState(node).richOverflowOwner) return;
      renderText(context, node, element);
      if (controlName(node) === 'RichTextBlock') markRichTextSource(context, node, () => renderText(context, node, element));
    }, afterLayout: textLayout,
    events: { click(context, node, element, event) {
      const link = event.target.closest?.('[data-hyperlink-id]');
      if (!link) return false;
      const hyperlink = context.nodes.get(link.dataset.hyperlinkId);
      context.emit(hyperlink, 'Click', {});
      context.services?.launcher?.launchUri(hyperlink.properties.NavigateUri).catch(error => context.host.options.onError?.(error));
      return true;
    }, pointerup: selectDisplayText, keyup: selectDisplayText }
  });
  registerFamily(registry, 'RichEditBox', {
    create: context => createPart(context.document, 'div', 'rich-editor'),
    render(context, node, element) {
      element.contentEditable = String(!node.properties.IsReadOnly);
      element.setAttribute('role', 'textbox');
      element.setAttribute('aria-multiline', 'true');
      element.dir = node.properties.FlowDirection === 1 ? 'rtl' : 'ltr';
      const model = richState(context, node);
      if (node.properties.RtfText && model.sceneRtf !== node.properties.RtfText) {
        model.silence(() => model.setText(node.properties.RtfText, 'rtf'));
        model.sceneRtf = node.properties.RtfText;
        renderRichDocument(context.document, element, model);
      } else if (node.properties.Text !== undefined && node.properties.Text !== model.text) {
        model.silence(() => model.setText(node.properties.Text));
        renderRichDocument(context.document, element, model);
      }
      if (element !== context.document.activeElement) renderRichDocument(context.document, element, model);
    }, getTextModel: getRichTextDocument,
    invoke(context, node, element, method, args = []) {
      const model = richState(context, node);
      if (method === 'GetText') return model.text;
      if (node.properties.IsEnabled === false) return false;
      if (method === 'SetValue') {
        if (node.properties.IsReadOnly) return false;
        model.setText(String(args[0]));
        renderRichDocument(context.document, element, model);
      } else if (method === 'SelectText') selectRichDom(context, node, element, Number(args[0]), Number(args[1]));
      else if (method === 'SelectAll') selectRichDom(context, node, element, 0, model.length);
      else return undefined;
      context.invalidate(node.id);
      return true;
    }, events: {
      input(context, node, element) {
        if (node.properties.IsReadOnly || node.properties.IsEnabled === false) {
          renderRichDocument(context.document, element, richState(context, node));
          return false;
        }
        richState(context, node).readDom(element);
        syncRichSelection(context, node, element);
        return true;
      },
      paste(context, node, element, event) {
        event.preventDefault();
        if (node.properties.IsReadOnly || node.properties.IsEnabled === false) return false;
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const selection = context.document.getSelection?.();
        if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return true;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(context.document.createTextNode(text));
        richState(context, node).readDom(element);
        return true;
      }, keyup: syncRichSelection, pointerup: syncRichSelection
    }
  });
}

export function getRichTextDocument(context, node) { return richState(context, node); }
