/** Presentation estimates are labeled; GPU completion is never called display presentation. */
export class FrameMetrics {
  constructor({now = () => performance.now(), refreshMs = 1000 / 60, onMetrics = () => {}} = {}) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) throw new RangeError('Invalid display refresh interval');
    this.now = now;
    this.refreshMs = refreshMs;
    this.onMetrics = onMetrics;
    this.lastPresent = null;
    this.serial = 0;
    this.pending = new Set();
    this.closed = false;
  }

  begin({inputTime = null, backend = 'unknown', adapter = null} = {}) {
    if (this.closed) throw new Error('Frame metrics are disposed');
    const frame = {
      id: ++this.serial, backend, adapter, started: this.now(), inputTime, submitMs: null,
      gpuDoneMs: null, inputToPresentMs: null, estimatedInputToPresentMs: null, droppedFrames: 0,
      presentationSource: null, presented: false, completed: false, emitted: false
    };
    this.pending.add(frame);
    return frame;
  }

  submitted(frame, completion = Promise.resolve()) {
    if (!this.pending.has(frame)) throw new TypeError('Unknown frame metric token');
    frame.submitMs = this.now() - frame.started;
    Promise.resolve(completion).then(() => {
      if (this.closed) return;
      frame.gpuDoneMs = this.now() - frame.started;
      frame.completed = true;
      this.emit(frame);
    }, error => {
      if (this.closed) return;
      frame.gpuError = String(error?.message ?? error);
      frame.completed = true;
      this.emit(frame);
    });
  }

  presented(frame, timestamp, {source = 'raf-estimate'} = {}) {
    if (!this.pending.has(frame) || !Number.isFinite(timestamp)) throw new TypeError('Invalid presentation sample');
    if (frame.presented) return;
    frame.presented = true;
    frame.presentationSource = source;
    frame.droppedFrames = this.lastPresent === null ? 0 : Math.max(0, Math.round((timestamp - this.lastPresent) / this.refreshMs) - 1);
    this.lastPresent = timestamp;
    if (frame.inputTime !== null) {
      const latency = Math.max(0, timestamp - frame.inputTime);
      if (source === 'presentation-feedback') frame.inputToPresentMs = latency;
      else frame.estimatedInputToPresentMs = latency;
    }
    this.emit(frame);
  }

  emit(frame) {
    if (!frame.completed || !frame.presented || frame.emitted) return;
    frame.emitted = true;
    this.pending.delete(frame);
    this.onMetrics(Object.freeze({...frame}));
  }

  dispose() {
    this.closed = true;
    this.pending.clear();
  }
}
