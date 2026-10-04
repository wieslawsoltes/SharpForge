import {createCanvasMeasureProvider, validateEnvironmentSnapshot} from '@sharpforge/winui-controls';
import {NativeCanvasTextProvider, TextLayoutService} from '@sharpforge/rendering';
import {assertUIHostData} from './ui-data.js';
import {RuntimeUIEventRequests, registerRuntimeEventRequests} from './ui-event-runtime.js';
import {registerControlStateHandler} from './control-state.js';
import {RuntimeBindingDiagnostics} from './binding-diagnostics.js';
import {RuntimeUIFrames} from './ui-frames.js';

const failure = (name, message) => Object.assign(new Error(message), {name});

/** Each launch buffers its own UI output before it becomes the active session. */
export class RuntimeUIBridge {
  constructor({post, wake, onError = () => {}, requestTimeout = 30000, maximumQueued = 20000, eventRequestOptions = {}} = {}) {
    if (typeof post !== 'function' || typeof wake !== 'function') throw new TypeError('Runtime UI bridge requires post and wake callbacks');
    if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 300000
      || !Number.isSafeInteger(maximumQueued) || maximumQueued < 1 || maximumQueued > 100000) {
      throw new RangeError('Invalid runtime UI bridge limits');
    }
    this.post = post;
    this.wake = wake;
    this.onError = onError;
    this.requestTimeout = requestTimeout;
    this.maximumQueued = maximumQueued;
    this.sessionId = null;
    this.vm = null;
    this.commands = [];
    this.privateValues = new Map();
    this.packets = [];
    this.requests = [];
    this.pending = new Map();
    this.nextRequest = 1;
    this.scheduled = false;
    this.closed = false;
    this.ownedTextService = null;
    this.bindingDiagnostics = new RuntimeBindingDiagnostics({schedule: () => this.scheduleFlush()});
    this.frames = new RuntimeUIFrames(this);
    this.eventRequests = new RuntimeUIEventRequests(this, {timeout: Math.min(requestTimeout, 30000), ...eventRequestOptions});
  }

  runtimeOptions({bindingAssembly, uiServices = {}} = {}) {
    const bridge = this;
    const services = {...uiServices};
    services.bindingDiagnostics = diagnostic => {
      this.bindingDiagnostics.report(diagnostic);
      try { uiServices.bindingDiagnostics?.(diagnostic); } catch { /* Diagnostic observers cannot fault managed bindings. */ }
    };
    if (!services.requestFrame && !services.scheduler?.requestFrame) {
      services.requestFrame = callback => this.frames.requestFrame(callback);
      services.cancelFrame = token => this.frames.cancelFrame(token);
    }
    if (!services.text && typeof globalThis.OffscreenCanvas === 'function') {
      this.ownedTextService ??= new TextLayoutService(new NativeCanvasTextProvider());
      services.text = this.ownedTextService;
    }
    if (!services.measureProvider && typeof globalThis.OffscreenCanvas === 'function') {
      services.measureProvider = createCanvasMeasureProvider(new OffscreenCanvas(1, 1), {
        resolve: id => bridge.vm?.platform.ui.services.layout?.nodes.get(id)
      });
    }
    return {bindingAssembly, uiServices: services,
      onUICommand: command => this.enqueue(this.commands, command),
      onUIComposition: packet => this.enqueue(this.packets, packet),
      onPrivateUIValue: (id, property, value) => this.privateValue(id, property, value),
      onUIWork: () => { if (!this.closed && this.vm) this.wake(this); },
      onExternalComplete: () => { if (!this.closed && this.vm) this.wake(this); },
      uiHostRequest: (kind, payload, options) => this.request(kind, payload, options)};
  }

  attach(vm, sessionId) {
    if (this.closed || this.vm || !Number.isSafeInteger(sessionId) || sessionId < 1) throw new TypeError('Invalid UI bridge activation');
    this.vm = vm;
    this.sessionId = sessionId;
    this.scheduleFlush();
    queueMicrotask(() => { if (!this.closed) this.wake(this); });
  }

  enqueue(queue, value) {
    if (this.closed) return;
    if (queue.length >= this.maximumQueued) throw new RangeError('Runtime UI output queue limit exceeded');
    queue.push(value);
    this.scheduleFlush();
  }

  privateValue(id, property, value) {
    if (this.closed) return;
    if (typeof id !== 'string' || property !== 'Password' || typeof value !== 'string' || value.length > 1048576) {
      throw new TypeError('Invalid private UI value');
    }
    if (this.privateValues.size >= this.maximumQueued && !this.privateValues.has(id)) throw new RangeError('Private UI queue limit');
    this.privateValues.set(id, {id, property, value});
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.scheduled || this.closed || !this.vm) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.closed) return;
      try { this.flush(); } catch (error) { this.onError(error); }
    });
  }

  flush() {
    if (this.closed || !this.vm) return;
    this.eventRequests.observe();
    this.frames.observe();
    const sessionId = this.sessionId;
    if (this.commands.length) this.post({event: 'ui', sessionId, commands: this.commands.splice(0)});
    if (this.privateValues.size) {
      const values = [...this.privateValues.values()];
      this.privateValues.clear();
      this.post({event: 'uiPrivateValues', sessionId, values});
    }
    if (this.packets.length) this.post({event: 'uiComposition', sessionId, packets: this.packets.splice(0)});
    this.bindingDiagnostics.flush(this.post, sessionId);
    for (const request of this.requests.splice(0)) {
      const pending = this.pending.get(request.requestId);
      if (!pending) continue;
      pending.sent = true;
      this.post({event: 'uiHostRequest', sessionId, ...request});
    }
  }

  request(kind, payload, {signal} = {}) {
    if (this.closed) return Promise.reject(failure('AbortError', 'UI session ended'));
    if (this.pending.size >= 64) return Promise.reject(failure('QuotaExceededError', 'UI host request limit exceeded'));
    if (typeof kind !== 'string' || !payload || typeof payload !== 'object') return Promise.reject(new TypeError('Invalid UI host request'));
    try { signal?.throwIfAborted(); assertUIHostData({kind, payload}); } catch (error) { return Promise.reject(error); }
    const requestId = this.nextRequest++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cancelRequest(requestId, failure('TimeoutError', 'UI host request timed out'));
      }, this.requestTimeout);
      const abort = () => this.cancelRequest(requestId, signal.reason ?? failure('AbortError', 'UI host request cancelled'));
      this.pending.set(requestId, {resolve, reject, timer, signal, abort, sent: false});
      signal?.addEventListener('abort', abort, {once: true});
    });
    try { this.enqueue(this.requests, {requestId, kind, payload}); }
    catch (error) { this.cancelRequest(requestId, error); }
    return promise;
  }

  cancelRequest(requestId, error) {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    this.releaseRequest(pending);
    const queued = this.requests.findIndex(request => request.requestId === requestId);
    if (queued >= 0) this.requests.splice(queued, 1);
    pending.reject(error);
    if (pending.sent && !this.closed && this.vm) {
      try { this.post({event: 'uiHostCancel', sessionId: this.sessionId, requestId}); }
      catch (failure) { this.onError(failure); }
    }
    if (!this.closed && this.vm) this.wake(this);
    return true;
  }

  releaseRequest(pending) {
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abort);
  }

  respond({requestId, result, error}) {
    const pending = this.pending.get(requestId);
    if (!pending || this.closed) return false;
    if (error && (typeof error.message !== 'string' || error.message.length > 16384)) throw new TypeError('Invalid host failure');
    assertUIHostData(error ?? result);
    this.pending.delete(requestId);
    this.releaseRequest(pending);
    if (error) {
      pending.reject(failure(String(error.name ?? 'Error').slice(0, 128), error.message));
    } else pending.resolve(result);
    queueMicrotask(() => { if (!this.closed) this.wake(this); });
    return true;
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.eventRequests.dispose();
    this.bindingDiagnostics.dispose();
    this.frames.dispose();
    for (const pending of this.pending.values()) {
      this.releaseRequest(pending);
      pending.reject(failure('AbortError', 'UI session ended'));
    }
    this.pending.clear();
    this.commands.length = this.packets.length = this.requests.length = 0;
    this.privateValues.clear();
    this.ownedTextService?.dispose();
    this.ownedTextService = null;
    this.vm = null;
  }
}

/** Worker request handlers resolve only managed identities in the active application. */
export function registerRuntimeUIHandlers(handlers, {current, interactive, flush, schedule}) {
  registerRuntimeEventRequests(handlers, {current, interactive, flush, schedule});
  registerControlStateHandler(handlers, {current, flush, schedule});
  const context = () => current().vm.platform.ui;
  const action = operation => params => {
    interactive();
    assertUIHostData(params);
    const result = operation(params);
    flush();
    schedule();
    return result;
  };
  handlers.registerHandler('uiPrivateInput', action(params => current().vm.platform.dispatchPrivateInput(params.id, params.property, params.value)));
  handlers.registerHandler('uiCollectionInput', action(params => context().collectionInput(context().reference(params.id), params.property, params.items)));
  handlers.registerHandler('uiLayoutSnapshot', params => {
    if (current().vm.state === 'paused') return false;
    assertUIHostData(params.snapshot);
    context().services.layout.updateFeedback(params.snapshot);
    context().services.automation.publishTree?.();
    return true;
  });
  handlers.registerHandler('uiEnvironmentSnapshot', params => {
    if (current().vm.state === 'paused') return false;
    assertUIHostData(params.snapshot);
    context().services.environment.updateFeedback(validateEnvironmentSnapshot(params.snapshot));
    flush();
    schedule();
    return true;
  });
  handlers.registerHandler('uiCompositionCompleted', action(params => context().composition.complete(params.value)));
  handlers.registerHandler('uiRealizeItems', action(params => {
    if (!Array.isArray(params.indices) || params.indices.length > 2048
      || params.indices.some(index => !Number.isSafeInteger(index) || index < 0)) throw new TypeError('Invalid item realization range');
    context().realizeItemIndices(context().reference(params.id), params.indices);
    return true;
  }));
  handlers.registerHandler('uiAutomationAction', action(params => {
    if (typeof params.id !== 'string' || typeof params.method !== 'string' || !Array.isArray(params.args) || params.args.length > 16) {
      throw new TypeError('Invalid automation action');
    }
    context().services.automation.tree.invoke(params.id, params.method, params.args, params.pattern ?? null);
    context().services.automation.publishTree?.();
    return true;
  }));
  handlers.registerHandler('uiHostResponse', params => current().bridge.respond(params));
}
