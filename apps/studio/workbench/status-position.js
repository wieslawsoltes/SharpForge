import {GraphemeSegmenter, visualColumnAt} from '@sharpforge/text';

/** Exact visual columns use the model's cancellable index; older hosts get a bounded prefix fallback. */
export class StatusPosition {
  constructor({onChange = () => {}, onError = () => {}} = {}) {
    this.onChange = onChange;
    this.onError = onError;
    this.segmenter = new GraphemeSegmenter();
    this.work = null;
  }

  column(source, position, {offset, tabSize = 4, visualColumn} = {}) {
    const current = this.work;
    const same = current?.source === source && current?.version === source?.version && current?.offset === offset && current?.tabSize === tabSize;
    if (!same) { current?.controller.abort(); this.work = null; }
    // Document notifications can precede a view's caret transform after a shrinking edit.
    // Leave this transient display unavailable; the view's next cursor event supplies a valid offset.
    const length = source?.length ?? source?.buffer?.length;
    if (Number.isSafeInteger(length) && Number.isSafeInteger(offset) && offset > length) {
      current?.controller.abort();
      this.work = null;
      return null;
    }
    if (Number.isFinite(visualColumn) && visualColumn >= 0) return visualColumn;
    if (!source || !Number.isSafeInteger(offset) || offset < position.character) return null;
    if (same) return current.column;
    const cached = source.cachedVisualColumnAtOffset?.(offset, {tabSize});
    if (Number.isFinite(cached)) return cached;
    const work = {source, version: source.version, offset, tabSize, controller: new AbortController(), column: null,
      pending: Boolean(source.visualColumnAtOffset)};
    this.work = work;
    if (source.visualColumnAtOffset) {
      Promise.resolve().then(() => source.visualColumnAtOffset(offset, {tabSize, signal: work.controller.signal})).then(column => {
        if (!this.current(work)) return;
        if (!Number.isFinite(column) || column < 0) throw new RangeError('Invalid visual column from model');
        work.column = column;
        work.pending = false;
        this.onChange();
      }).catch(error => {
        if (!this.current(work) || error.name === 'AbortError') return;
        work.pending = false;
        this.onError(error);
        this.onChange();
      });
      return null;
    }
    const eager = Object.getOwnPropertyDescriptor(source, 'text')?.value;
    if (position.character > 16382 || !source.getText && typeof eager !== 'string') return null;
    const start = offset - position.character;
    const end = Math.min(source.length ?? source.buffer?.length ?? eager?.length ?? offset, offset + 2);
    const text = source.getText ? source.getText(start, end) : eager.slice(start, end);
    work.column = visualColumnAt(text, position.character, {tabSize, segmenter: this.segmenter});
    return work.column;
  }

  current(work) {
    return this.work === work && !work.controller.signal.aborted && work.source.version === work.version;
  }

  get pending() { return this.work?.pending ?? false; }

  dispose() { this.work?.controller.abort(); this.work = null; }
}
