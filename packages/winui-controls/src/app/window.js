import { ControlEvents, ControlError } from '../policy/events.js';
import { dispatchDeferred } from '../overlay/deferrals.js';

/** Logical application windows work in browsers; native presenters require an explicit host adapter. */
export class WindowSession extends ControlEvents {
  constructor({ title = '', width = 800, height = 600, x = 0, y = 0, scale = 1, platform = {}, timeout = 5000 } = {}) {
    super();
    this.title = title;
    this.bounds = { X: x, Y: y, Width: width, Height: height };
    this.scale = scale;
    this.platform = platform;
    this.timeout = timeout;
    this.visible = false;
    this.closed = false;
    this.closing = false;
    this.closePromise = null;
    this.closeController = null;
    this.presentationPending = false;
    this.content = null;
    this.titleBar = null;
    this.presenter = 'Overlapped';
    this.validateBounds();
  }
  validateBounds() {
    if (Object.values(this.bounds).some(value => !Number.isFinite(value)) || this.bounds.Width < 0 || this.bounds.Height < 0
      || !Number.isFinite(this.scale) || this.scale <= 0) {
      throw new ControlError('SFUI16A6', 'Window bounds must be finite and nonnegative in size');
    }
  }
  activate() { if (this.closed) throw new ControlError('SFUI16A7', 'Window is closed'); this.setVisible(true); this.emit('Activated', { WindowActivationState: 2 }); }
  setVisible(visible) {
    if (visible && this.closed) throw new ControlError('SFUI16A7', 'Window is closed');
    if (this.visible === !!visible) return;
    this.visible = !!visible;
    this.emit('VisibilityChanged', { Visible: this.visible });
    this.emit('Changed', { DidVisibilityChange: true });
  }
  resize(width, height) {
    const previous = this.bounds;
    this.bounds = { ...previous, Width: width, Height: height };
    try { this.validateBounds(); } catch (error) { this.bounds = previous; throw error; }
    this.emit('SizeChanged', { Size: { Width: width, Height: height } });
    this.emit('Changed', { DidSizeChange: true });
  }
  move(x, y) {
    const previous = this.bounds;
    this.bounds = { ...previous, X: x, Y: y };
    try { this.validateBounds(); } catch (error) { this.bounds = previous; throw error; }
    this.emit('Changed', { DidPositionChange: true });
  }
  async setPresenter(presenter, { signal } = {}) {
    if (this.closed) throw new ControlError('SFUI16A7', 'Window is closed');
    if (this.presentationPending) throw new ControlError('SFUI16A8', 'A presenter transition is already pending');
    if (presenter === this.presenter) return;
    const method = presenter === 'Overlapped' ? this.platform.exitPresentation : presenter === 'FullScreen'
      ? this.platform.fullscreen : presenter === 'CompactOverlay' ? this.platform.pictureInPicture : null;
    if (!method) throw new ControlError('SFUI16A8', 'Requested window presenter is unavailable', { presenter });
    this.presentationPending = true;
    try {
      await method.call(this.platform, { signal });
      signal?.throwIfAborted();
      if (this.closed) throw new ControlError('SFUI16A7', 'Window closed during presenter transition');
      this.presenter = presenter;
      this.emit('Changed', { DidPresenterChange: true });
    } finally { this.presentationPending = false; }
  }
  close(options = {}) {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return Promise.resolve(false);
    let resolveResult;
    let rejectResult;
    this.closePromise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const result = this.closePromise;
    this.#close(options).then(resolveResult, rejectResult);
    return result;
  }
  async #close({ signal }) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.closeController = controller;
    this.closing = true;
    try {
      const args = await dispatchDeferred(this, 'Closing', {}, { timeout: this.timeout, signal: controller.signal });
      if (args.Cancel) return false;
      controller.signal.throwIfAborted();
      const closed = this.emit('Closed', { Handled: false });
      if (closed.Handled) return false;
      this.closed = true;
      this.setVisible(false);
      this.emit('CloseCommitted', {});
      return true;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.closing = false;
      this.closeController = null;
      this.closePromise = null;
    }
  }
  snapshot() {
    if (this.closing || this.presentationPending) {
      throw new ControlError('SFUI16A9', 'An active window operation cannot be snapshotted');
    }
    return { version: 1, title: this.title, bounds: { ...this.bounds }, scale: this.scale, visible: this.visible,
      closed: this.closed, content: this.content, titleBar: this.titleBar, presenter: this.presenter };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI16A9', 'Invalid window snapshot');
    if (this.presenter !== snapshot.presenter || this.presentationPending || this.closing) {
      throw new ControlError('SFUI16A9', 'An external presenter transition or pending close cannot be rewound');
    }
    for (const key of ['title', 'scale', 'visible', 'closed', 'content', 'titleBar', 'presenter']) this[key] = snapshot[key];
    this.bounds = { ...snapshot.bounds };
    this.closing = false;
  }
  *retainedValues() { yield this.content; yield this.titleBar; }
  dispose({ preserveValues = false } = {}) {
    if (preserveValues) return;
    this.closeController?.abort(new ControlError('SFUI16A7', 'Window was disposed'));
    this.visible = false;
    this.closed = true;
    this.content = this.titleBar = null;
    super.dispose();
  }
}
