const fields = ['horizontalOffset', 'verticalOffset', 'zoomFactor'];
const clock = () => globalThis.performance?.now() ?? Date.now();

/** One bounded view operation owns its scheduled frame and completion; replacement completes it as interrupted. */
export class ScrollAnimation {
  constructor(owner, { now = clock, requestFrame = callback => setTimeout(() => callback(now()), 16),
    cancelFrame = clearTimeout, duration = 180, animationsEnabled = () => true } = {}) {
    if (!Number.isFinite(duration) || duration < 0 || duration > 10000) throw new RangeError('Invalid scroll animation duration');
    Object.assign(this, { owner, now, requestFrame, cancelFrame, duration, animationsEnabled });
    this.operation = null;
    this.frame = null;
    this.sequence = 0;
  }
  begin(target, { animate = true, automatic = true, onComplete = () => {} } = {}) {
    const sequence = ++this.sequence;
    this.cancel();
    if (sequence !== this.sequence) { onComplete('Interrupted'); return; }
    const from = Object.fromEntries(fields.map(name => [name, this.owner[name]]));
    if (fields.every(name => from[name] === target[name])) { onComplete('Ignored'); return; }
    const operation = { from, target, start: this.now(), onComplete, automatic };
    this.operation = operation;
    this.owner.onEvent('ViewChanging', { NextView: { HorizontalOffset: target.horizontalOffset,
      VerticalOffset: target.verticalOffset, ZoomFactor: target.zoomFactor } });
    if (this.operation !== operation) return;
    if (!animate || !this.duration || automatic && !this.animationsEnabled()) { this.sample(operation, 1); return; }
    this.frame = this.requestFrame(time => this.tick(operation, time));
  }
  tick(operation, time) {
    this.frame = null;
    if (this.operation !== operation) return;
    const elapsed = Math.max(0, (Number.isFinite(time) ? time : this.now()) - operation.start);
    const progress = operation.automatic && !this.animationsEnabled() ? 1 : Math.min(1, elapsed / this.duration);
    this.sample(operation, progress);
    if (progress < 1 && this.operation === operation) this.frame = this.requestFrame(next => this.tick(operation, next));
  }
  sample(operation, progress) {
    const eased = 1 - (1 - progress) ** 3;
    const sampled = fields.map(name => operation.from[name] + (operation.target[name] - operation.from[name]) * eased);
    Object.assign(this.owner, this.owner.targetView(...sampled));
    if (progress === 1) this.operation = null;
    this.owner.onEvent('ViewChanged', { IsIntermediate: progress < 1 });
    if (progress === 1) operation.onComplete('Completed');
  }
  cancel(result = 'Interrupted') {
    if (this.frame != null) this.cancelFrame(this.frame);
    this.frame = null;
    const operation = this.operation;
    this.operation = null;
    operation?.onComplete(result);
  }
  dispose() { this.cancel('Interrupted'); }
}
