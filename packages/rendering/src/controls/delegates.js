import {RenderDelegateRegistry} from '../drawing/delegates.js';
import {renderShape, localBounds} from './shape-renderer.js';
import {renderBorder, renderPanel, renderFocusVisual} from './border-renderer.js';
import {renderText} from './text-renderer.js';
import {renderCanvasControl} from './canvas-control.js';
import {DrawingContext} from '../drawing/context.js';

/** Rendering consumes resolved templates: default control chrome is ordinary Border/Shape/Text descendants. */
export function registerControlRenderers(registry) {
  for (const name of ['Rectangle', 'Ellipse', 'Line', 'Polygon', 'Polyline', 'Path', 'PathIcon']) registry.register(name, renderShape);
  registry.register('Border', renderBorder);
  for (const name of ['Panel', 'Canvas', 'Grid', 'StackPanel', 'WrapGrid', 'ItemsWrapGrid', 'VariableSizedWrapGrid',
    'RelativePanel', 'ItemsStackPanel', 'ContentPresenter', 'Page', 'UserControl', 'Window', 'SwapChainPanel']) registry.register(name, renderPanel);
  for (const name of ['TextBlock', 'RichTextBlock']) registry.register(name, renderText);
  registry.register('Image', (node, layout, context, resources, options) => {
    const p = node.properties, image = options.resolveImage ? options.resolveImage(p.Source) : p.Source;
    if (image) context.DrawImage(image, localBounds(layout), {stretch: p.Stretch ?? 2, nineGrid: p.NineGrid, sampling: p.SamplingMode ?? 'linear'});
  });
  for (const name of ['Button', 'CheckBox', 'RadioButton', 'ToggleSwitch', 'Slider', 'ProgressBar', 'ProgressRing',
    'ToggleButton', 'TextBox', 'PasswordBox', 'ListViewItem', 'ComboBox', 'ContentControl']) registry.register(name,
    (node, layout, context) => { if (!node.templateRoot) renderBorder(node, layout, context); renderFocusVisual(node, layout, context); });
  registry.register('ScrollViewer', (node, layout, context) => renderPanel(node, layout, context));
  for (const name of ['Popup', 'FlyoutPresenter', 'MenuFlyoutPresenter', 'ContentDialog']) registry.register(name, renderBorder);
  for (const name of ['CanvasControl', 'CanvasAnimatedControl']) registry.register(name, renderCanvasControl);
  return registry;
}
export function createControlRenderers(options) { return registerControlRenderers(new RenderDelegateRegistry(options)); }

/** Scroll offsets and clipping belong to the compositor; static item display lists remain retained. */
export function scrollLayer(content, viewport, {offsetX = 0, offsetY = 0} = {}) {
  const drawing = new DrawingContext({elementId: content.elementId, version: content.version});
  drawing.PushClip({kind: 'rectangle', rect: viewport});
  drawing.PushTransform([1, 0, 0, 1, -offsetX, -offsetY]);
  drawing.DrawLayer({displayList: content, bounds: content.bounds, cacheKey: `scroll:${content.elementId}`, contentVersion: content.version});
  drawing.Pop(); drawing.Pop();
  return {displayList: drawing.finish(viewport), opacity: 1};
}
export function overlayLayer(content, {zIndex = 0, modal = false, smoke = '#66000000', shadow = null} = {}) {
  return {displayList: content, overlay: true, zIndex, modal, smoke, effect: shadow};
}
