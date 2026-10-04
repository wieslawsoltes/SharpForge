import {isLinearGradient, gradientFailure} from './gradient-data.js';
import {gradientPaint, gradientSvgDocument, gradientSvgImage, linearGradientSvg} from './gradient-svg.js';
import {gradientBorderSvg} from './gradient-border.js';
import {cssColor} from './surface.js';

const textTypes = new Set(['TextBlock', 'Button', 'ToggleButton', 'AppBarButton', 'HyperlinkButton', 'MenuFlyoutItem', 'ContentControl']);
const shapes = new Set(['Rectangle', 'Ellipse', 'Line']);
const suffix = type => type.slice(type.lastIndexOf('.') + 1);

export const hasHostGradient = properties => isLinearGradient(properties.Background) || isLinearGradient(properties.Foreground)
  || isLinearGradient(properties.BorderBrush) || isLinearGradient(properties.Fill) || isLinearGradient(properties.Stroke);

export function resetHostBrushColors(properties, style) {
  style.borderColor = cssColor(properties.BorderBrush);
  style.background = properties.Background ? cssColor(properties.Background) : '';
  style.color = properties.Foreground ? cssColor(properties.Foreground) : '';
}

/** Shape gradients remain native DOM/SVG paint; the solid-only drawing surface never silently erases them. */
export function shapeUsesDomPaint(node, element) {
  if (node.properties.RenderTransform?.$ref) {
    element.dataset.renderFallback = 'transformed shape uses DOM';
    return true;
  }
  if (hasHostGradient(node.properties)) {
    element.dataset.renderFallback = 'linear gradient shape uses DOM SVG';
    return true;
  }
  delete element.dataset.renderFallback;
  return false;
}

function shapeImage(properties, type, box) {
  if (type === 'Line') throw gradientFailure('Line gradient paint is not supported; use Rectangle or Ellipse.');
  const fill = gradientPaint(properties.Fill, 'fill', box);
  const stroke = gradientPaint(properties.Stroke, 'stroke', box);
  const thickness = properties.Stroke ? Math.max(0, properties.StrokeThickness ?? 1) : 0;
  const inset = Math.min(thickness / 2, box.width / 2, box.height / 2);
  const width = Math.max(0, box.width - inset * 2);
  const height = Math.max(0, box.height - inset * 2);
  const geometry = type === 'Ellipse'
    ? `<ellipse cx="${box.width / 2}" cy="${box.height / 2}" rx="${width / 2}" ry="${height / 2}"`
    : `<rect x="${inset}" y="${inset}" width="${width}" height="${height}" ` +
      `rx="${Math.max(0, properties.RadiusX ?? 0)}" ry="${Math.max(0, properties.RadiusY ?? 0)}"`;
  return gradientSvgDocument(box, fill.definition + stroke.definition,
    `${geometry} fill="${fill.paint}" stroke="${stroke.paint}" stroke-width="${thickness}"/>`);
}

function paintLayers(node, box) {
  const properties = node.properties;
  const type = suffix(node.type);
  if (shapes.has(type)) return {layers: [shapeImage(properties, type, box)], clips: ['border-box'], shape: true};
  const layers = [];
  const clips = [];
  const add = (svg, clip = 'border-box') => { layers.push(svg); clips.push(clip); };
  const foreground = isLinearGradient(properties.Foreground);
  if (foreground) {
    if (!textTypes.has(type) || properties.Content?.$ref || node.templateRoot) {
      throw gradientFailure('Foreground gradients require an untemplated scalar-text control or TextBlock.');
    }
    add(linearGradientSvg(properties.Foreground, box), 'text');
  }
  if (isLinearGradient(properties.BorderBrush)) add(gradientBorderSvg(properties, box));
  if (isLinearGradient(properties.Background)) add(linearGradientSvg(properties.Background, box));
  // A final transparent layer keeps an ordinary Background color clipped to the border, not to foreground glyphs.
  if (!layers.length || clips.at(-1) === 'text') add(gradientSvgDocument(box, '', ''));
  return {layers, clips, foreground};
}

/** Paint after layout using untransformed CSS box dimensions; resize and retained-width updates use the same seam. */
export function paintHostGradients(node, element, measuredBox) {
  const style = element.style;
  if (!hasHostGradient(node.properties)) {
    if (element.dataset.gradientPaint) {
      style.backgroundImage = '';
      style.backgroundClip = '';
      style.backgroundOrigin = '';
      style.backgroundSize = '';
      style.backgroundRepeat = '';
      style.webkitTextFillColor = '';
      delete element.dataset.gradientPaint;
    }
    return;
  }
  const box = {
    width: element.offsetWidth ?? measuredBox.width,
    height: element.offsetHeight ?? measuredBox.height
  };
  const plan = paintLayers(node, box);
  style.backgroundImage = plan.layers.map(gradientSvgImage).join(', ');
  style.backgroundClip = plan.clips.join(', ');
  style.backgroundOrigin = 'border-box';
  style.backgroundSize = '100% 100%';
  style.backgroundRepeat = 'no-repeat';
  style.webkitTextFillColor = plan.foreground ? 'transparent' : '';
  if (plan.shape || isLinearGradient(node.properties.BorderBrush)) style.borderColor = 'transparent';
  element.dataset.gradientPaint = 'svg-relative-pad-srgb';
}
