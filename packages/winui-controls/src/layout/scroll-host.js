import { ScrollViewerModel } from './scrollviewer.js';
import { ScrollViewModel } from './scrollview.js';
import { sceneSnapPoints } from './scroll-options.js';
import { findScrollPresenter, scrollOwner } from './scroll-presenter.js';
import { synchronizeScrollControllers, completeScrollControllers } from './scroll-controllers.js';
import { scrollConfiguration } from './scroll-configuration.js';

const viewProperties = ['HorizontalOffset', 'VerticalOffset', 'ZoomFactor'];
const modelFields = ['horizontalOffset', 'verticalOffset', 'zoomFactor'];
const shortType = type => type.split('.').at(-1);

function animationOptions(host) {
  const frames = host.input?.frameClock ?? host.options?.scrollFrames ?? host.services?.scrollFrames;
  return { ...(frames ?? {}), now: frames?.now ?? (() =>
    host.document?.defaultView.performance.now() ?? globalThis.performance?.now() ?? Date.now()),
  animationsEnabled: () => host.services?.environment?.AnimationsEnabled !== false };
}

/** One model is shared by wheel/touch, native scrollbar parts, automation and managed API calls. */
export function getScrollModel(host, id, modern = null) {
  id = findScrollPresenter(host.nodes.get(id), key => host.nodes.get(key)) ?? id;
  const node = host.nodes.get(id);
  if (!node) throw new Error('SFUI1673: Scroll target is not in this host');
  modern ??= shortType(node.type) !== 'ScrollViewer';
  const state = host.context.getState(node);
  let model = state.scrollModel;
  if (!model || modern && !(model instanceof ScrollViewModel)) {
    model?.dispose();
    const Constructor = modern ? ScrollViewModel : ScrollViewerModel;
    model = new Constructor({ ...animationOptions(host), onEvent: (event, payload) => {
      const owner = scrollOwner(host, node);
      if (event === 'ViewChanged') {
        for (let index = 0; index < viewProperties.length; index++) node.properties[viewProperties[index]] = model[modelFields[index]];
        if (owner) for (let index = 0; index < viewProperties.length; index++) owner.properties[viewProperties[index]] = model[modelFields[index]];
        cacheScrollView(host, node.id, model);
        if (owner) cacheScrollView(host, owner.id, model);
        host.invalidate(id, 'arrange');
      }
      if (event === 'ScrollCompleted') completeScrollControllers(host, node, payload.CorrelationId);
      host.emit(node, event, { ...payload, ...scrollModelMetrics(model) });
      if (owner) host.emit(owner, event, { ...payload, ...scrollModelMetrics(model) });
    } });
    state.scrollModel = model;
  }
  configureScrollModel(host, node, model);
  if (model instanceof ScrollViewModel) {
    const owner = scrollOwner(host, node);
    synchronizeScrollControllers(host, scrollConfiguration(node, owner), model);
  }
  return model;
}

function cacheScrollView(host, id, model) {
  const state = host.layoutEngine.states.get(id);
  if (!state) return;
  state.data.scroll = { ...state.data.scroll,
    extent: { width: model.extentWidth, height: model.extentHeight },
    viewport: { width: model.viewportWidth, height: model.viewportHeight },
    horizontalOffset: model.horizontalOffset, verticalOffset: model.verticalOffset, zoomFactor: model.zoomFactor };
}

function configureScrollModel(host, node, model) {
  const owner = scrollOwner(host, node);
  const source = scrollConfiguration(node, owner);
  const properties = source.properties;
  const minimum = properties.MinZoomFactor ?? 0.1, maximum = properties.MaxZoomFactor ?? 10;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum < minimum) {
    throw new RangeError('SFUI1673: Invalid zoom limits');
  }
  model.minimumZoomFactor = minimum;
  model.maximumZoomFactor = maximum;
  model.horizontalScrollMode = properties.HorizontalScrollMode ?? 1;
  model.verticalScrollMode = properties.VerticalScrollMode ?? 1;
  for (let index = 0; index < viewProperties.length; index++) {
    if (properties[viewProperties[index]] != null) model[modelFields[index]] = properties[viewProperties[index]];
  }
  const scroll = host.layoutEngine.states.get(node.id)?.data.scroll;
  if (scroll) model.setExtent(scroll.extent, scroll.viewport);
  if (!(model instanceof ScrollViewModel)) return;
  const resolve = id => host.nodes.get(id);
  model.horizontalSnapPoints = sceneSnapPoints(source, 'HorizontalSnapPoints', resolve, model.viewportWidth / model.zoomFactor);
  model.verticalSnapPoints = sceneSnapPoints(source, 'VerticalSnapPoints', resolve, model.viewportHeight / model.zoomFactor);
  model.zoomSnapPoints = sceneSnapPoints(source, 'ZoomSnapPoints', resolve);
}

export function scrollModelMetrics(model) {
  return { HorizontalOffset: model.horizontalOffset, VerticalOffset: model.verticalOffset, ZoomFactor: model.zoomFactor,
    ExtentWidth: model.extentWidth, ExtentHeight: model.extentHeight, ViewportWidth: model.viewportWidth,
    ViewportHeight: model.viewportHeight, ScrollableWidth: model.scrollableWidth, ScrollableHeight: model.scrollableHeight };
}

/** Arrange can clamp or anchor an offset after content changes; publish that actual view into the retained model. */
export function synchronizeScrollView(host, node) {
  const scroll = host.layoutEngine.states.get(node.id)?.data.scroll;
  if (!scroll) return null;
  for (let index = 0; index < viewProperties.length; index++) node.properties[viewProperties[index]] = scroll[modelFields[index]];
  host.layoutEngine.states.get(node.id).data.scrollRequested = { horizontal: scroll.horizontalOffset, vertical: scroll.verticalOffset };
  return getScrollModel(host, node.id);
}
