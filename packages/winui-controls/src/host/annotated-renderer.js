import { makeElement } from './dom-properties.js';
import { annotatedLabels } from '../layout/annotated-scrollbar.js';
import { presentedAnnotatedLabels, annotatedTemplateContent, annotatedVisualChildren } from '../layout/annotated-content.js';
import { getAnnotatedController, synchronizeAnnotatedController } from '../layout/annotated-host.js';
import { inverseMatrix, transformPoint } from '../layout/render-properties.js';

function state(context, node) { return context.getState(node).annotated; }
function create(context, node) {
  const root = makeElement(context);
  const up = makeElement(context, 'button', { type: 'button', 'data-annotated-step': '-1', 'aria-label': 'Scroll up' });
  const down = makeElement(context, 'button', { type: 'button', 'data-annotated-step': '1', 'aria-label': 'Scroll down' });
  up.textContent = '▲'; down.textContent = '▼';
  const rail = makeElement(context, 'div', { 'data-annotated-rail': '', role: 'scrollbar', 'aria-orientation': 'vertical',
    'aria-label': 'Annotated scroll position', tabindex: '0' });
  const thumb = makeElement(context, 'div', { 'data-annotated-thumb': '' });
  const labels = makeElement(context, 'div', { 'data-annotated-labels': '' });
  const detail = makeElement(context, 'div', { role: 'tooltip', 'data-annotated-detail': '' });
  detail.id = context.host.rootKey + ':' + node.id + ':detail';
  detail.hidden = true;
  Object.assign(detail.style, { position: 'absolute', maxWidth: '360px', width: 'max-content', whiteSpace: 'normal',
    overflowWrap: 'anywhere', background: 'Canvas', color: 'CanvasText', border: '1px solid', padding: '6px', zIndex: '2' });
  Object.assign(thumb.style, { position: 'absolute', width: '4px', height: '18px', left: '8px', background: 'currentColor',
    borderRadius: '2px', pointerEvents: 'none' });
  for (const element of [up, down, rail, labels]) element.style.position = 'absolute';
  rail.style.touchAction = 'none';
  rail.append(thumb);
  root.append(up, down, rail, labels, detail);
  context.getState(node).annotated = { up, down, rail, thumb, labels, detail, rows: [], drag: null,
    detailController: null, detailOffset: null };
  return root;
}
function render(context, node) {
  const parts = state(context, node), labels = presentedAnnotatedLabels(node, context.resolve);
  synchronizeAnnotatedController(context, node);
  while (parts.rows.length > labels.length) {
    const row = parts.rows.pop();
    row.remove();
  }
  for (const [index, label] of labels.entries()) {
    const row = parts.rows[index] ?? makeElement(context, 'div', { 'data-annotated-label': String(index) });
    parts.rows[index] = row;
    Object.assign(row.style, { position: 'absolute', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', cursor: 'pointer' });
    context.content(row, label.Content);
  }
  context.ordered(parts.labels, parts.rows);
  parts.labels.style.pointerEvents = 'none';
  for (const row of parts.rows) row.style.pointerEvents = 'auto';
}
function afterLayout(context, node, element, layout) {
  const parts = state(context, node), model = getAnnotatedController(context, node);
  const geometry = context.host.layoutEngine.states.get(node.id)?.data.annotatedLayout;
  if (!geometry) return;
  const { buttonHeight, railHeight, visible } = geometry;
  Object.assign(parts.up.style, { left: '0', top: '0', width: '24px', height: buttonHeight + 'px' });
  Object.assign(parts.down.style, { left: '0', bottom: '0', width: '24px', height: buttonHeight + 'px' });
  Object.assign(parts.rail.style, { left: '0', top: buttonHeight + 'px', width: '24px', height: railHeight + 'px' });
  Object.assign(parts.labels.style, { inset: '0' });
  const ratio = model.maximum > model.minimum ? (model.offset - model.minimum) / (model.maximum - model.minimum) : 0;
  parts.thumb.style.top = Math.max(0, ratio * Math.max(0, railHeight - 18)) + 'px';
  parts.up.disabled = node.properties.IsEnabled === false || !model.canScroll || model.offset <= model.minimum;
  parts.down.disabled = node.properties.IsEnabled === false || !model.canScroll || model.offset >= model.maximum;
  parts.rail.tabIndex = node.properties.IsEnabled === false ? -1 : 0;
  for (const [name, value] of [['aria-valuemin', model.minimum], ['aria-valuemax', model.maximum], ['aria-valuenow', model.offset],
    ['aria-disabled', !model.canScroll]]) parts.rail.setAttribute(name, String(value));
  const positions = new Map(visible.map(value => [value.index, value]));
  for (const [index, row] of parts.rows.entries()) {
    const item = positions.get(index);
    row.hidden = !item;
    if (!item) continue;
    const managed = context.host.layoutEngine.states.get(node.id)?.data.annotatedLabels[index]?.Content?.$ref;
    Object.assign(row.style, { left: managed ? '0' : '28px', top: managed ? '0' : buttonHeight + item.y + 'px',
      width: Math.max(0, layout.renderSize.width - (managed ? 0 : 28)) + 'px', height: managed ? '100%' : item.height + 'px' });
  }
}
function offsetAt(context, node, event) {
  const inverse = inverseMatrix(context.host.getLayout(node.id)?.worldTransform ?? [1, 0, 0, 1, 0, 0]);
  const point = inverse ? transformPoint(inverse, context.host.input.position(event)) : { y: 0 };
  const geometry = context.host.layoutEngine.states.get(node.id)?.data.annotatedLayout;
  const model = getAnnotatedController(context, node);
  const ratio = Math.max(0, Math.min(1, (point.y - (geometry?.buttonHeight ?? 0)) / Math.max(1, geometry?.railHeight ?? 1)));
  return model.minimum + ratio * (model.maximum - model.minimum);
}
function requestScroll(context, node, offset, kind) {
  getAnnotatedController(context, node).scroll(offset, kind).catch(error => {
    if (error.name !== 'AbortError') context.host.options.onError(error);
  });
}
function hideDetail(context, node) {
  const parts = state(context, node);
  parts.detailController?.abort();
  parts.detailController = null;
  parts.detailOffset = null;
  parts.detail.hidden = true;
  parts.rail.removeAttribute('aria-describedby');
  const layout = context.host.layoutEngine.states.get(node.id);
  if (layout?.data.annotatedDetailActive) {
    layout.data.annotatedDetailActive = false;
    context.invalidate(node.id);
  }
}

function presentDetail(context, node, content) {
  const parts = state(context, node);
  const generated = annotatedTemplateContent(node).detail;
  if (node.properties.DetailLabelTemplate && generated !== content?.$ref) {
    throw new Error('SFTPL018: DetailLabelTemplate must be materialized by the managed event response');
  }
  context.content(parts.detail, content);
  const managed = !!content?.$ref;
  parts.detailVisual = content?.$ref ?? null;
  Object.assign(parts.detail.style, managed ? { left: '0px', top: '0px', width: '100%', height: '100%',
    maxWidth: 'none', padding: '0', border: '0', background: 'transparent', pointerEvents: 'none' }
    : { left: Math.min(context.host.getLayout(node.id)?.renderSize.width ?? 24, 48) + 'px', top: '24px',
      width: 'max-content', height: 'auto', maxWidth: '360px', padding: '6px', border: '1px solid', background: 'Canvas' });
  parts.detail.hidden = false;
  parts.rail.setAttribute('aria-describedby', parts.detail.id);
  const layout = context.host.layoutEngine.states.get(node.id);
  if (layout) {
    layout.data.annotatedDetailActive = true;
    layout.data.annotatedDetailId = parts.detailVisual;
  }
  context.invalidate(node.id);
}
function showDetail(context, node, event) {
  const parts = state(context, node), offset = offsetAt(context, node, event);
  if (parts.detailOffset === Math.round(offset)) return;
  parts.detailOffset = Math.round(offset);
  parts.detailController?.abort();
  const controller = new AbortController();
  parts.detailController = controller;
  context.requestEvent(node, 'DetailLabelRequested', { ScrollOffset: offset, Content: null }, { signal: controller.signal }).then(result => {
    if (controller.signal.aborted) return;
    if (result?.Content == null) return hideDetail(context, node);
    presentDetail(context, node, result.Content);
  }).catch(error => { if (error.name !== 'AbortError') context.host.options.onError(error); });
}
const events = {
  click(context, node, element, event) {
    if (node.properties.IsEnabled === false) return;
    const direction = Number(event.target.closest?.('[data-annotated-step]')?.dataset.annotatedStep);
    if (!direction) return;
    const model = getAnnotatedController(context, node);
    requestScroll(context, node, model.offset + direction * model.smallChange, direction > 0 ? 2 : 3);
  },
  pointerdown(context, node, element, event) {
    if (event.target.closest?.('[data-annotated-step]') || event.button > 0) return;
    const parts = state(context, node), model = getAnnotatedController(context, node);
    if (!model.canScroll || node.properties.IsEnabled === false) return;
    parts.drag = event.pointerId;
    model.setMouseScrolling(event.pointerType === 'mouse');
    context.host.input.capture.capture(node.id, event.pointerId);
    const label = event.target.closest?.('[data-annotated-label]');
    const offset = label ? annotatedLabels(node, context.resolve)[Number(label.dataset.annotatedLabel)].ScrollOffset : offsetAt(context, node, event);
    requestScroll(context, node, offset, 0);
    event.preventDefault();
  },
  pointermove(context, node, element, event) {
    if (state(context, node).drag === event.pointerId) requestScroll(context, node, offsetAt(context, node, event), 1);
    else showDetail(context, node, event);
  },
  pointerup(context, node) { state(context, node).drag = null; getAnnotatedController(context, node).setMouseScrolling(false); },
  pointercancel(context, node) { events.pointerup(context, node); hideDetail(context, node); },
  lostpointercapture(context, node) { events.pointerup(context, node); },
  pointerout(context, node, element, event) { if (!element.contains(event.relatedTarget)) hideDetail(context, node); },
  keydown(context, node, element, event) {
    if (node.properties.IsEnabled === false) return;
    const model = getAnnotatedController(context, node);
    const delta = { ArrowDown: model.smallChange, ArrowUp: -model.smallChange, PageDown: model.viewport,
      PageUp: -model.viewport, Home: model.minimum - model.offset, End: model.maximum - model.offset }[event.key];
    if (delta != null) { requestScroll(context, node, model.offset + delta, delta > 0 ? 2 : 3); event.preventDefault(); }
    if (event.key === 'Escape') hideDetail(context, node);
  }
};

export function registerAnnotatedScrollRenderer(registry) {
  registry.register('AnnotatedScrollBar', { create, render, afterLayout, events,
    bubbleEvents: ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'click'],
    getVisualChildren: (context, node) => {
      const children = annotatedVisualChildren(node, context.resolve);
      const detail = context.getState(node).annotated?.detailVisual;
      if (detail && !children.includes(detail)) children.push(detail);
      return children;
    },
    automationElement: (context, node) => state(context, node).rail,
    dispose(context, node) {
      hideDetail(context, node);
      getAnnotatedController(context, node).dispose();
    } });
}
