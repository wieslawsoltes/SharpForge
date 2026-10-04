import { ControlEvents, ControlError } from '../policy/events.js';
import { dispatchDeferred } from '../overlay/deferrals.js';

/** Application identity, windows and resources are explicit; several sessions may coexist. */
export class ApplicationSession extends ControlEvents {
  constructor({ resources = null, requestedTheme = 0, timeout = 5000, saveState = null } = {}) {
    super();
    this.resources = resources;
    this.requestedTheme = requestedTheme;
    this.timeout = timeout;
    this.saveState = saveState;
    this.windows = new Map();
    this.state = 'created';
    this.activation = null;
    this.suspensionState = null;
    this.pending = false;
    this.suspensionPromise = null;
    this.suspensionController = null;
    this.generation = 0;
    this.background = false;
  }
  start(callback, activation = { Kind: 'Launch', Arguments: '' }) {
    if (this.state !== 'created') throw new ControlError('SFUI16A0', 'Application has already started');
    this.state = 'running';
    try { callback?.(this); this.activate(activation); }
    catch (error) { this.unhandled(error); }
  }
  activate(args) {
    if (this.state === 'closed') throw new ControlError('SFUI16A1', 'Application is closed');
    this.activation = args;
    this.emit(args.Kind === 'Launch' ? 'Launched' : 'Activated', args);
  }
  registerWindow(id, window) {
    if (this.windows.has(id)) throw new ControlError('SFUI16A2', 'A window with this identity already exists');
    this.windows.set(id, window);
    return () => this.windows.delete(id);
  }
  suspend(options = {}) {
    if (this.suspensionPromise) return this.suspensionPromise;
    if (this.state !== 'running') return Promise.resolve(false);
    let resolveResult;
    let rejectResult;
    this.suspensionPromise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const result = this.suspensionPromise;
    this.#suspend(options).then(resolveResult, rejectResult);
    return result;
  }
  async #suspend({ signal, persisted = false }) {
    const controller = new AbortController();
    const generation = this.generation;
    this.suspensionController = controller;
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.pending = true;
    try {
      const args = await dispatchDeferred(this, 'Suspending', { Persisted: persisted, State: this.suspensionState },
        { timeout: this.timeout, signal: controller.signal });
      if (args.Cancel) return false;
      this.suspensionState = args.State;
      await this.saveState?.(this.suspensionState, controller.signal);
      controller.signal.throwIfAborted();
      if (generation !== this.generation) return false;
      this.state = 'suspended';
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.pending = false;
      this.suspensionController = null;
      this.suspensionPromise = null;
    }
  }
  resume({ persisted = false } = {}) {
    if (this.state === 'closed') return;
    this.generation++;
    this.suspensionController?.abort(new ControlError('SFUI16A4', 'Suspension was superseded by resume'));
    this.state = 'running';
    this.emit('Resuming', { Persisted: persisted, State: this.suspensionState });
  }
  visibility(visible) {
    if (this.background === !visible) return;
    this.background = !visible;
    this.emit(visible ? 'LeavingBackground' : 'EnteredBackground', {});
    for (const window of this.windows.values()) window.setVisible(visible);
  }
  unhandled(error) {
    const args = this.emit('UnhandledException', { Exception: error, Message: error.message, Handled: false });
    if (!args.Handled) throw error;
  }
  exit() {
    if (this.state === 'closed') return;
    this.generation++;
    this.suspensionController?.abort(new ControlError('SFUI16A4', 'Application exited during suspension'));
    for (const window of this.windows.values()) window.dispose?.();
    this.windows.clear();
    this.state = 'closed';
    this.emit('Exiting', {});
  }
  snapshot() {
    if (this.pending) throw new ControlError('SFUI16A3', 'An active suspension deferral cannot be snapshotted');
    return { version: 1, state: this.state, activation: this.activation, suspensionState: this.suspensionState,
      requestedTheme: this.requestedTheme, windows: [...this.windows], background: this.background };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI16A3', 'Invalid application snapshot');
    this.state = snapshot.state;
    this.activation = snapshot.activation;
    this.suspensionState = snapshot.suspensionState;
    this.requestedTheme = snapshot.requestedTheme;
    this.windows = new Map(snapshot.windows);
    this.background = snapshot.background ?? false;
    this.pending = false;
  }
  *retainedValues() { yield this.resources; yield this.activation; yield this.suspensionState; yield* this.windows.values(); }
  dispose({ preserveValues = false } = {}) {
    if (preserveValues) return;
    this.exit();
    super.dispose();
  }
}

/** Browser lifecycle is observed without pretending that it is a Windows process lifecycle. */
export class VisibilityLifecycle {
  constructor(application, { document, window, onError = error => application.unhandled(error) } = {}) {
    this.application = application;
    this.listeners = [];
    const on = (target, name, listener) => {
      target?.addEventListener(name, listener);
      this.listeners.push([target, name, listener]);
    };
    on(document, 'visibilitychange', () => application.visibility(document.visibilityState !== 'hidden'));
    on(window, 'pagehide', event => application.suspend({ persisted: event.persisted }).catch(onError));
    on(window, 'pageshow', event => { if (event.persisted) application.resume({ persisted: true }); });
    on(document, 'freeze', () => application.suspend().catch(onError));
    on(document, 'resume', () => application.resume());
  }
  dispose() { for (const [target, name, listener] of this.listeners) target?.removeEventListener(name, listener); this.listeners.length = 0; }
}
