import { ScrollViewerModel } from './scrollviewer.js';
import { clamp } from './geometry.js';
import { normalizeScrollOptions, normalizeSnapPoint } from './scroll-options.js';

/** Correlation IDs identify completion even when a subsequent request supersedes a view. */
export class ScrollViewModel extends ScrollViewerModel {
  constructor(options = {}) {
    super(options);
    this.nextCorrelationId = 1;
    this.horizontalSnapPoints = [];
    this.verticalSnapPoints = [];
    this.zoomSnapPoints = [];
  }

  request(kind, values, options = {}) {
    if (this.disposed) throw new Error('ScrollView has been disposed');
    const supplied = options.correlationId;
    if (supplied != null && (!Number.isSafeInteger(supplied) || supplied <= 0 || supplied > 2147483647)) {
      throw new RangeError('SFUI1673: Invalid scroll correlation id');
    }
    const correlationId = supplied ?? this.nextCorrelationId;
    this.nextCorrelationId = Math.max(this.nextCorrelationId, correlationId + 1);
    if (correlationId > 2147483647) throw new RangeError('SFUI1673: Scroll correlation id exhausted');
    const policy = normalizeScrollOptions(options);
    const snap = policy.snapPointsMode === 0;
    const horizontal = values.horizontalOffset == null ? null
      : snap && kind === 'scroll' ? nearestSnap(values.horizontalOffset, this.horizontalSnapPoints) : values.horizontalOffset;
    const vertical = values.verticalOffset == null ? null
      : snap && kind === 'scroll' ? nearestSnap(values.verticalOffset, this.verticalSnapPoints) : values.verticalOffset;
    const zoom = values.zoomFactor == null ? null : snap ? nearestSnap(values.zoomFactor, this.zoomSnapPoints) : values.zoomFactor;
    this.beginView(horizontal, vertical, zoom, { animate: policy.animationMode !== 0, automatic: policy.animationMode === 2,
      onComplete: result => this.onEvent(kind === 'zoom' ? 'ZoomCompleted' : 'ScrollCompleted', { CorrelationId: correlationId, Result: result }) });
    return correlationId;
  }

  scrollTo(horizontalOffset, verticalOffset, options) { return this.request('scroll', { horizontalOffset, verticalOffset }, options); }
  scrollBy(horizontalDelta, verticalDelta, options) {
    return this.scrollTo(this.horizontalOffset + horizontalDelta, this.verticalOffset + verticalDelta, options);
  }
  zoomTo(zoomFactor, centerPoint = null, options) {
    if (!Number.isFinite(zoomFactor)) throw new TypeError('Zoom factor must be finite');
    centerPoint ??= { x: this.viewportWidth / 2, y: this.viewportHeight / 2 };
    const snapped = normalizeScrollOptions(options).snapPointsMode === 0 ? nearestSnap(zoomFactor, this.zoomSnapPoints) : zoomFactor;
    const zoom = clamp(snapped, this.minimumZoomFactor, this.maximumZoomFactor);
    if (![centerPoint.x, centerPoint.y].every(Number.isFinite)) throw new TypeError('Zoom center must be finite');
    return this.request('zoom', {
      zoomFactor: zoom,
      horizontalOffset: this.horizontalOffset + centerPoint.x / this.zoomFactor - centerPoint.x / zoom,
      verticalOffset: this.verticalOffset + centerPoint.y / this.zoomFactor - centerPoint.y / zoom
    }, options);
  }
}

export function nearestSnap(value, points) {
  if (!Number.isFinite(value)) throw new TypeError('Snap coordinate must be finite');
  let nearest = value;
  let distance = Infinity;
  if (!Array.isArray(points) || points.length > 2048) throw new RangeError('SFUI1673: Snap point collection limit');
  for (const entry of points) {
    const point = normalizeSnapPoint(entry);
    const candidate = typeof point === 'number' ? point : repeatedSnap(value, point);
    if (!Number.isFinite(candidate)) throw new TypeError('Invalid snap point');
    const delta = Math.abs(candidate - value);
    if (delta < distance || delta === distance && candidate < nearest) {
      nearest = candidate;
      distance = delta;
    }
  }
  return nearest;
}

function repeatedSnap(value, { offset = 0, interval, start = 0, end = Infinity }) {
  if (!Number.isFinite(interval) || interval <= 0 || start > end) throw new TypeError('Invalid repeated snap interval');
  const first = Math.ceil((start - offset) / interval);
  const last = Math.floor((end - offset) / interval);
  if (first > last) throw new RangeError('Repeated snap range contains no snap points');
  return offset + clamp(Math.round((value - offset) / interval), first, last) * interval;
}
