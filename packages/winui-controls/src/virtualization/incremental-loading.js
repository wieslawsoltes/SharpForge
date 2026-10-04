/** One load at a time; disposal aborts the provider and suppresses stale completions. */
export class IncrementalLoader {
  constructor(source, { threshold = 2, pageSize = 64, onChanged = () => {}, onError = () => {} } = {}) {
    this.source = source;
    this.threshold = threshold;
    this.pageSize = pageSize;
    this.onChanged = onChanged;
    this.onError = onError;
    this.pending = null;
    this.controller = null;
    this.disposed = false;
  }
  nearEnd({ end, start }) {
    if (this.disposed || this.source.HasMoreItems === false || this.source.hasMoreItems === false) return Promise.resolve(null);
    if (this.source.count - end > Math.max(1, end - start) * this.threshold) return Promise.resolve(null);
    if (this.pending) return this.pending;
    const load = this.source.LoadMoreItemsAsync ?? this.source.loadMoreItems;
    if (typeof load !== 'function') return Promise.resolve(null);
    this.controller = new AbortController();
    const controller = this.controller;
    this.pending = Promise.resolve().then(() => load.call(this.source, this.pageSize, { signal: controller.signal }))
      .then(result => {
        if (!this.disposed && !controller.signal.aborted) this.onChanged(result);
        return result;
      }, error => {
        if (!controller.signal.aborted) { this.onError(error); throw error; }
        return null;
      }).finally(() => { if (this.controller === controller) { this.pending = null; this.controller = null; } });
    return this.pending;
  }
  dispose() { this.disposed = true; this.controller?.abort(); }
}
