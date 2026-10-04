import { clamp } from './geometry.js';

export const AnnotatedScrollBarScrollingEventKind = Object.freeze({ Click: 0, Drag: 1, IncrementButton: 2, DecrementButton: 3 });

function coordinate(value, name) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new RangeError('SFUI1676: Invalid annotated scrollbar ' + name);
  return value;
}

/** A UI-thread scroll controller; composition panning is optional and therefore exposes null PanningInfo. */
export class AnnotatedScrollController {
  constructor({ onChange = () => {}, onEvent = () => {}, requestEvent = async (_, args) => args,
    scrollTo = null } = {}) {
    Object.assign(this, { onChange, onEvent, requestEvent, scrollTo });
    this.minimum = this.maximum = this.offset = this.viewport = 0;
    this.smallChange = 16;
    this.isScrollable = true;
    this.isScrollingWithMouse = false;
    this.pending = new Set();
    this.completed = new Set();
    this.request = null;
    this.disposed = false;
  }
  get canScroll() { return this.isScrollable && this.maximum > this.minimum; }
  setValues(minimum, maximum, offset, viewport) {
    for (const [name, value] of Object.entries({ minimum, maximum, offset, viewport })) coordinate(value, name);
    if (minimum > maximum || viewport < 0) throw new RangeError('SFUI1676: Invalid annotated scrollbar range');
    const previous = this.canScroll;
    Object.assign(this, { minimum, maximum, offset: clamp(offset, minimum, maximum), viewport });
    if (this.canScroll !== previous) this.onEvent('CanScrollChanged', {});
    this.onChange();
  }
  setIsScrollable(value) {
    const previous = this.canScroll;
    this.isScrollable = !!value;
    if (this.canScroll !== previous) this.onEvent('CanScrollChanged', {});
    this.onChange();
  }
  setMouseScrolling(value) {
    if (this.isScrollingWithMouse === !!value) return;
    this.isScrollingWithMouse = !!value;
    this.onEvent('IsScrollingWithMouseChanged', {});
    this.onChange();
  }
  async scroll(offset, kind = 0, { signal } = {}) {
    if (this.disposed) throw new Error('Annotated scrollbar was disposed');
    coordinate(offset, 'offset');
    if (!Number.isInteger(kind) || kind < 0 || kind > 3) throw new RangeError('SFUI1676: Invalid annotated scrolling event kind');
    if (!this.canScroll) return -1;
    this.request?.abort();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener('abort', abort, { once: true });
    this.request = controller;
    try {
      const target = clamp(offset, this.minimum, this.maximum);
      const args = { ScrollOffset: target, ScrollingEventKind: kind, Cancel: false,
        IsScrollingWithMouse: this.isScrollingWithMouse };
      const outcome = await this.requestEvent('Scrolling', args, { signal: controller.signal });
      if (controller.signal.aborted || outcome?.Cancel) return -1;
      const request = { Offset: target, Options: { AnimationMode: kind === 1 ? 0 : 2, SnapPointsMode: 1 }, CorrelationId: -1 };
      this.onEvent('ScrollToRequested', request);
      const correlation = this.scrollTo ? this.scrollTo(target, request.Options) : request.CorrelationId;
      if (Number.isInteger(correlation) && correlation >= 0 && !this.completed.delete(correlation)) {
        if (this.pending.size >= 64) throw new RangeError('SFUI1676: Pending annotated scroll operation limit');
        this.pending.add(correlation);
      }
      this.offset = target;
      this.onChange();
      return correlation ?? -1;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.request === controller) this.request = null;
    }
  }
  notifyRequestedScrollCompleted(correlation) {
    if (this.pending.delete(correlation)) return;
    if (this.completed.size >= 64) this.completed.delete(this.completed.values().next().value);
    this.completed.add(correlation);
  }
  snapshot() {
    return { minimum: this.minimum, maximum: this.maximum, offset: this.offset, viewport: this.viewport,
      smallChange: this.smallChange, isScrollable: this.isScrollable, isScrollingWithMouse: this.isScrollingWithMouse };
  }
  restore(value) {
    this.request?.abort();
    this.pending.clear();
    this.completed.clear();
    this.smallChange = coordinate(value.smallChange, 'small change');
    this.isScrollable = !!value.isScrollable;
    this.isScrollingWithMouse = !!value.isScrollingWithMouse;
    this.setValues(value.minimum, value.maximum, value.offset, value.viewport);
  }
  dispose() { this.disposed = true; this.request?.abort(); this.pending.clear(); this.completed.clear(); }
}

/** Project labels through their content offsets and remove overlapping upper labels, preserving the first label. */
export function arrangeAnnotatedLabels(labels, { minimum = 0, maximum = 0, height, heights = [], spacing = 4 } = {}) {
  if (!Array.isArray(labels) || labels.length > 2048) throw new RangeError('SFUI1676: Annotated label collection limit');
  coordinate(height, 'rail height');
  if (height < 0 || maximum < minimum) throw new RangeError('SFUI1676: Invalid annotated label geometry');
  const candidates = labels.map((label, index) => {
    const offset = coordinate(label.ScrollOffset ?? label.scrollOffset, 'label offset');
    const labelHeight = Math.max(0, coordinate(heights[index] ?? 20, 'label height'));
    const ratio = maximum > minimum ? clamp((offset - minimum) / (maximum - minimum), 0, 1) : 0;
    return { index, offset, y: clamp(ratio * height, 0, Math.max(0, height - labelHeight)), height: labelHeight };
  }).sort((left, right) => left.y - right.y || left.index - right.index);
  const visible = [];
  for (const candidate of candidates) {
    while (visible.length > 1 && visible.at(-1).y + visible.at(-1).height + spacing > candidate.y) visible.pop();
    if (!visible.length || visible.at(-1).y + visible.at(-1).height + spacing <= candidate.y) visible.push(candidate);
  }
  return visible;
}

export function annotatedLabels(node, resolve) {
  const reference = node.properties.Labels;
  const source = node.collections?.Labels ?? (Array.isArray(reference) ? reference
    : reference?.$ref ? resolve(reference.$ref)?.collections?.Items : []);
  if (!Array.isArray(source) || source.length > 2048) throw new RangeError('SFUI1676: Annotated label collection limit');
  return source.map(value => value?.$ref ? resolve(value.$ref)?.properties ?? {} : value?.properties ?? value);
}
