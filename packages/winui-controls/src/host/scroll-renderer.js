import { makeElement } from './dom-properties.js';
import { getScrollModel, synchronizeScrollView } from '../layout/scroll-host.js';
import { scrollInputEvents } from './scroll-input.js';
import { findScrollPresenter } from '../layout/scroll-presenter.js';

const axes = ['Horizontal', 'Vertical'];
function create(context, node) {
  const element = makeElement(context);
  const content = makeElement(context, 'div', { 'data-scroll-content': '' });
  Object.assign(content.style, { position: 'absolute', inset: '0', overflow: 'visible' });
  const bars = axes.map(axis => {
    const bar = makeElement(context, 'input', { type: 'range', 'data-scroll-axis': axis, 'aria-label': axis + ' scroll position' });
    bar.min = '0';
    bar.step = 'any';
    bar.tabIndex = -1;
    Object.assign(bar.style, { position: 'absolute', margin: '0', zIndex: '1' });
    if (axis === 'Horizontal') Object.assign(bar.style, { left: '0', bottom: '0', width: '100%', height: '12px' });
    else Object.assign(bar.style, { right: '0', top: '0', height: '100%', width: '12px', writingMode: 'vertical-lr', direction: 'rtl' });
    return bar;
  });
  context.getState(node).scrollParts = { content, bars };
  element.append(content, ...bars);
  return element;
}
function render(context, node, element) {
  const { content } = context.getState(node).scrollParts;
  context.content(content, node.properties.Content);
  element.style.touchAction = 'none';
  element.style.padding = '0px';
  if (node.properties.IsTabStop !== false) element.tabIndex = 0;
}
function afterLayout(context, node) {
  if (findScrollPresenter(node, context.resolve)) return;
  const model = synchronizeScrollView(context.host, node);
  if (!model) return;
  const parts = context.getState(node).scrollParts;
  for (let index = 0; index < axes.length; index++) {
    const axis = axes[index], bar = parts.bars[index];
    const maximum = index ? model.scrollableHeight : model.scrollableWidth;
    const visibility = node.properties[axis + 'ScrollBarVisibility'] ?? 1;
    bar.hidden = visibility === 0 || visibility === 2 || visibility === 'Disabled' || visibility === 'Hidden'
      || visibility !== 3 && visibility !== 'Visible' && maximum <= 0;
    bar.disabled = maximum <= 0 || node.properties[axis + 'ScrollMode'] === 0;
    bar.max = String(maximum);
    bar.value = String(index ? model.verticalOffset : model.horizontalOffset);
    bar.setAttribute('aria-valuenow', bar.value);
    bar.setAttribute('aria-valuemax', bar.max);
    bar.setAttribute('aria-orientation', axis.toLowerCase());
  }
}
function input(context, node, element, event) {
  const axis = event.target.dataset.scrollAxis;
  if (!axes.includes(axis)) return;
  const model = getScrollModel(context.host, node.id);
  model.interact(axis === 'Horizontal' ? Number(event.target.value) : null,
    axis === 'Vertical' ? Number(event.target.value) : null, null, event.type === 'input');
}

export function registerScrollRenderers(registry) {
  const events = Object.fromEntries(Object.entries(scrollInputEvents).map(([name, callback]) =>
    [name, (context, node, element, event) => { if (!findScrollPresenter(node, context.resolve)) callback(context, node, element, event); }]));
  registry.register(['ScrollViewer', 'ScrollView', 'ScrollPresenter'], { create, render, afterLayout,
    bubbleEvents: ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'],
    events: { ...events, input, change: input }, dispose(context, node) {
      context.getState(node).scrollModel?.dispose();
      context.getState(node).scrollTouch?.pointers.clear();
      for (const controller of context.getState(node).scrollControllers?.values() ?? []) controller.scrollTo = null;
    } });
}
