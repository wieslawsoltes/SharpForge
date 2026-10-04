import {resolvedProperties, validateDesign} from './model.js';

const interactive = new Set(['Button', 'HyperlinkButton', 'RepeatButton', 'ToggleButton', 'CheckBox', 'RadioButton',
  'TextBox', 'PasswordBox', 'NumberBox', 'ComboBox', 'Slider', 'ToggleSwitch', 'DatePicker', 'TimePicker', 'AutoSuggestBox']);
const contentNamed = new Set(['Button', 'HyperlinkButton', 'RepeatButton', 'ToggleButton', 'CheckBox', 'RadioButton']);

function color(value) {
  const channels = value?.Color ?? value;
  if (channels && ['R', 'G', 'B'].every(channel => Number.isFinite(channels[channel]))) {
    return [channels.R / 255, channels.G / 255, channels.B / 255, (channels.A ?? 255) / 255];
  }
  if (typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
    const text = value.length === 7 ? 'ff' + value.slice(1) : value.slice(1);
    return [2, 4, 6, 0].map(index => parseInt(text.slice(index, index + 2), 16) / 255);
  }
  return null;
}

function over(foreground, background) {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (!alpha) return [0, 0, 0, 0];
  return [...foreground.slice(0, 3).map((channel, index) =>
    (channel * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha), alpha];
}

function luminance(value) {
  const linear = value.slice(0, 3).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

/** WCAG relative luminance contrast for opaque effective sRGB colors. */
export function designerContrastRatio(foreground, background) {
  const back = color(background);
  const front = color(foreground);
  if (!back || !front || back[3] < 1) return null;
  const first = luminance(over(front, back));
  const second = luminance(back);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

function effectiveBackground(node, nodes, parents, resolved, cache) {
  if (cache.has(node.id)) return cache.get(node.id);
  const chain = [];
  let result = null;
  for (let current = node; current; current = nodes.get(parents.get(current.id))) {
    if (cache.has(current.id)) {
      result = cache.get(current.id);
      break;
    }
    chain.push(current);
    if (color(resolved.get(current.id).Background)?.[3] === 1) break;
  }
  for (const current of chain.reverse()) {
    const local = color(resolved.get(current.id).Background);
    if (local) result = result ? over(local, result) : local;
    cache.set(current.id, result);
  }
  return result;
}

function nameOf(properties, kind) {
  const explicit = properties['AutomationProperties.Name'] ?? properties['Microsoft.UI.Xaml.Automation.AutomationProperties.Name'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  if (typeof properties.Header === 'string' && properties.Header.trim()) return properties.Header;
  if (contentNamed.has(kind) && typeof properties.Content === 'string') return properties.Content.trim();
  return '';
}

/** Checks document names, explicit color contrast, tab stops and target sizes without running application code. */
export function checkDesignAccessibility(document, {geometry = new Map(), isVisible = () => true, signal, maxDiagnostics = 500} = {}) {
  if (!document?.nodes || document.nodes.length > 1000) throw new TypeError('Accessibility checking requires a bounded design document');
  if (!Number.isInteger(maxDiagnostics) || maxDiagnostics < 1 || maxDiagnostics > 5000) throw new RangeError('Invalid diagnostic limit');
  if (signal?.aborted) throw signal.reason ?? new DOMException('Accessibility check canceled', 'AbortError');
  document = validateDesign(document);
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of document.nodes) for (const child of node.children) parents.set(child, node.id);
  const resolved = new Map(document.nodes.map(node => [node.id, resolvedProperties(document, node).properties]));
  const backgrounds = new Map();
  const tabIndices = new Map();
  const results = [];
  const report = (node, code, message, fixHint, details = {}) => {
    if (results.length < maxDiagnostics) results.push({
      code, source: 'Designer', category: 'Accessibility', severity: 'warning', nodeId: node.id,
      message, fixHint, ...details
    });
  };
  for (const node of document.nodes) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Accessibility check canceled', 'AbortError');
    if (!isVisible(node.id)) continue;
    const properties = resolved.get(node.id);
    if (properties.Visibility === 1) continue;
    const kind = node.type.split('.').at(-1);
    if (interactive.has(kind)) {
      if (!nameOf(properties, kind)) report(node, 'SFDA0001', kind + ' has no accessible name.',
        'Set Content, Header, or AutomationProperties.Name to a meaningful label.');
      if (properties.IsEnabled !== false && (properties.IsTabStop === false || properties.TabIndex < 0)) {
        report(node, 'SFDA0003', kind + ' is excluded from keyboard tab navigation.',
          'Provide an equivalent keyboard action or enable IsTabStop with a nonnegative TabIndex.');
      }
      const tab = properties.TabIndex;
      if (Number.isInteger(tab) && tab > 0) {
        if (tabIndices.has(tab)) report(node, 'SFDA0003', 'Explicit TabIndex ' + tab + ' is used by multiple controls.',
          'Use document order or assign a distinct TabIndex.', {relatedNodeId: tabIndices.get(tab)});
        else tabIndices.set(tab, node.id);
      }
      const bounds = geometry.get?.(node.id) ?? geometry[node.id] ?? properties;
      const width = bounds.width ?? bounds.Width;
      const height = bounds.height ?? bounds.Height;
      if (Number.isFinite(width) && Number.isFinite(height) && (width < 24 || height < 24)) {
        report(node, 'SFDA0004', 'The pointer target is smaller than 24 × 24 design units.',
          'Increase the target or ensure the WCAG target-spacing exception applies.', {width, height});
      }
    }
    const foreground = properties.Foreground;
    const background = effectiveBackground(node, nodes, parents, resolved, backgrounds);
    if (foreground && background?.[3] === 1) {
      const back = {R: background[0] * 255, G: background[1] * 255, B: background[2] * 255, A: 255};
      const ratio = designerContrastRatio(foreground, back);
      const large = properties.FontSize >= 24 || properties.FontSize >= 18.66 && properties.FontWeight?.Weight >= 700;
      const minimum = large ? 3 : 4.5;
      if (ratio !== null && ratio < minimum && (properties.Text || properties.Content || interactive.has(kind))) {
        report(node, 'SFDA0002', `Text contrast ${ratio.toFixed(2)}:1 is below ${minimum}:1.`,
          'Choose foreground and background colors with sufficient contrast.', {ratio, minimum});
      }
    }
  }
  return results;
}
