import { size, rect, finite, clamp, insets, innerSize, addInsets } from './geometry.js';
import { ScrollAnimation } from './scroll-animation.js';
import { anchorScroll } from './scroll-anchoring.js';

/** Scroll state is independent of native scrolling; offsets are unscaled content DIPs. */
export class ScrollViewerModel {
  constructor({ onEvent = () => {}, zoomMinimum = 0.1, zoomMaximum = 10, ...animation } = {}) {
    this.onEvent = onEvent;
    this.minimumZoomFactor = zoomMinimum;
    this.maximumZoomFactor = zoomMaximum;
    this.zoomFactor = 1;
    this.horizontalOffset = 0;
    this.verticalOffset = 0;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.extentWidth = 0;
    this.extentHeight = 0;
    this.horizontalScrollMode = 1;
    this.verticalScrollMode = 1;
    this.animation = new ScrollAnimation(this, animation);
    this.disposed = false;
  }

  get scrollableWidth() { return Math.max(0, this.extentWidth - this.viewportWidth / this.zoomFactor); }
  get scrollableHeight() { return Math.max(0, this.extentHeight - this.viewportHeight / this.zoomFactor); }
  get frame() { return this.animation.frame; }

  setExtent(extent, viewport, anchor = null) {
    const oldWidth = this.extentWidth;
    const oldHeight = this.extentHeight;
    this.extentWidth = Math.max(0, extent.width);
    this.extentHeight = Math.max(0, extent.height);
    this.viewportWidth = Math.max(0, viewport.width);
    this.viewportHeight = Math.max(0, viewport.height);
    if (anchor?.horizontalRatio != null) this.horizontalOffset += (this.extentWidth - oldWidth) * anchor.horizontalRatio;
    if (anchor?.verticalRatio != null) this.verticalOffset += (this.extentHeight - oldHeight) * anchor.verticalRatio;
    this.horizontalOffset = clamp(this.horizontalOffset, 0, this.scrollableWidth);
    this.verticalOffset = clamp(this.verticalOffset, 0, this.scrollableHeight);
  }

  changeView(horizontalOffset, verticalOffset, zoomFactor, disableAnimation = false) {
    if (this.disposed) return false;
    this.beginView(horizontalOffset, verticalOffset, zoomFactor, { animate: !disableAnimation });
    return true;
  }

  targetView(horizontalOffset, verticalOffset, zoomFactor) {
    for (const value of [horizontalOffset, verticalOffset, zoomFactor]) {
      if (value != null && !Number.isFinite(value)) throw new TypeError('Scroll offsets and zoom must be finite');
    }
    const zoom = clamp(zoomFactor ?? this.zoomFactor, this.minimumZoomFactor, this.maximumZoomFactor);
    const horizontal = this.horizontalScrollMode === 0 ? 0 : clamp(horizontalOffset ?? this.horizontalOffset,
      0, Math.max(0, this.extentWidth - this.viewportWidth / zoom));
    const vertical = this.verticalScrollMode === 0 ? 0 : clamp(verticalOffset ?? this.verticalOffset,
      0, Math.max(0, this.extentHeight - this.viewportHeight / zoom));
    return { horizontalOffset: horizontal, verticalOffset: vertical, zoomFactor: zoom };
  }

  beginView(horizontal, vertical, zoom, options) { this.animation.begin(this.targetView(horizontal, vertical, zoom), options); }

  interact(horizontal, vertical, zoom, intermediate = false) {
    if (this.disposed) return false;
    const target = this.targetView(horizontal, vertical, zoom);
    const changed = Object.entries(target).some(([name, value]) => this[name] !== value);
    if (!changed && intermediate) return false;
    this.animation.cancel();
    if (changed) this.onEvent('ViewChanging', { NextView: { HorizontalOffset: target.horizontalOffset,
      VerticalOffset: target.verticalOffset, ZoomFactor: target.zoomFactor } });
    Object.assign(this, target);
    this.onEvent('ViewChanged', { IsIntermediate: intermediate });
    return changed;
  }

  zoomAt(factor, point, disableAnimation = true) {
    const zoom = clamp(factor, this.minimumZoomFactor, this.maximumZoomFactor);
    const horizontal = this.horizontalOffset + point.x / this.zoomFactor - point.x / zoom;
    const vertical = this.verticalOffset + point.y / this.zoomFactor - point.y / zoom;
    return this.changeView(horizontal, vertical, zoom, disableAnimation);
  }

  dispose() {
    this.disposed = true;
    this.animation.dispose();
  }
}

export const scrollViewerLayout = {
  measure(context, available) {
    const inset = insets(context.properties);
    const viewport = innerSize(available, inset);
    const properties = context.properties;
    const orientation = properties.ContentOrientation;
    const horizontal = properties.HorizontalScrollMode !== 0 && properties.HorizontalScrollBarVisibility !== 0
      && orientation !== 0 && orientation !== 2 && orientation !== 'Vertical' && orientation !== 'None';
    const vertical = properties.VerticalScrollMode !== 0 && properties.VerticalScrollBarVisibility !== 0
      && orientation !== 1 && orientation !== 2 && orientation !== 'Horizontal' && orientation !== 'None';
    const constraint = size(horizontal ? Infinity : viewport.width, vertical ? Infinity : viewport.height);
    let extent = size();
    for (const child of context.children) {
      const desired = context.measure(child, constraint);
      extent = size(Math.max(extent.width, desired.width), Math.max(extent.height, desired.height));
    }
    context.data.extent = extent;
    return addInsets(size(Math.min(extent.width, viewport.width), Math.min(extent.height, viewport.height)), inset);
  },
  arrange(context, finalSize) {
    const inset = insets(context.properties);
    const viewport = innerSize(finalSize, inset);
    const extent = context.data.extent ?? size();
    const properties = context.properties;
    const zoom = clamp(finite(properties.ZoomFactor, 1), properties.MinZoomFactor ?? 0.1, properties.MaxZoomFactor ?? 10);
    const requested = { horizontal: finite(properties.HorizontalOffset), vertical: finite(properties.VerticalOffset) };
    const previous = context.data.scroll;
    const horizontalValue = previous && context.data.scrollRequested?.horizontal === requested.horizontal
      ? previous.horizontalOffset : requested.horizontal;
    const verticalValue = previous && context.data.scrollRequested?.vertical === requested.vertical
      ? previous.verticalOffset : requested.vertical;
    const horizontal = properties.HorizontalScrollMode === 0 ? 0
      : clamp(horizontalValue, 0, Math.max(0, extent.width - viewport.width / zoom));
    const vertical = properties.VerticalScrollMode === 0 ? 0
      : clamp(verticalValue, 0, Math.max(0, extent.height - viewport.height / zoom));
    context.data.scrollRequested = requested;
    context.data.clip = rect(inset.left, inset.top, viewport.width, viewport.height);
    context.data.scroll = { extent, viewport, horizontalOffset: horizontal, verticalOffset: vertical, zoomFactor: zoom };
    for (const child of context.children) {
      context.arrange(child, rect(inset.left, inset.top,
        Math.max(extent.width, viewport.width / zoom), Math.max(extent.height, viewport.height / zoom)));
    }
    anchorScroll(context, context.data.scroll);
    context.data.childTransform = [zoom, 0, 0, zoom, -context.data.scroll.horizontalOffset * zoom, -context.data.scroll.verticalOffset * zoom];
  }
};
