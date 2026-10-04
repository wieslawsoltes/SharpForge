import {assertUIHostData} from './workers/ui-data.js';
import {StudioUIEventClient} from './ui-event-client.js';
import {HostUIFrameRequests} from './ui-frame-requests.js';
import {WinUIHost} from '@sharpforge/winui';
import {AnimationClock} from '@sharpforge/framework';
import {FrameScheduler, CompositionTransportHost} from '@sharpforge/rendering';
import {DataPackage, invokeHostControl, serializeRoutedEvent, createControlServices,
  validateDropToken, validateEnvironmentSnapshot} from '@sharpforge/winui-controls';

const eventNames = new Set(['ui', 'uiComposition', 'uiPrivateValues', 'uiHostRequest', 'uiHostCancel']);
const clipboardMethods = Object.freeze({ReadText: 'readText', WriteText: 'writeText', ReadImage: 'readImage', WriteImage: 'writeImage'});
const windowMethods = Object.freeze({Activate: 'activate', Close: 'close', Resize: 'resize', Move: 'move', SetPresenter: 'setPresenter'});
const validSession = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  || Number.isSafeInteger(value) && value >= 0;

async function clipboardRequest(service, payload, signal) {
  if (!service || !Array.isArray(payload.args) || payload.args.length > 1) throw new TypeError('Invalid clipboard operation');
  if (payload.method === 'GetContent' && service.getContent) {
    const result = await service.getContent({signal});
    return {...result, data: result.data?.snapshot() ?? null};
  }
  if (payload.method === 'SetContent' && service.setContent) {
    const snapshot = payload.args[0];
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.values) || snapshot.values.length > 3) {
      throw new TypeError('Invalid clipboard data package');
    }
    const data = new DataPackage();
    for (const [format, value] of snapshot.values) data.set(format, value);
    data.RequestedOperation = snapshot.requestedOperation ?? 0;
    return service.setContent(data, {signal});
  }
  const method = Object.hasOwn(clipboardMethods, payload.method) ? clipboardMethods[payload.method] : null;
  if (!method || !service) throw new TypeError('Unsupported clipboard host operation');
  if (!Array.isArray(payload.args) || payload.args.length > 1) throw new TypeError('Invalid clipboard arguments');
  if (typeof service[method] === 'function') return service[method](...payload.args, {signal});
  if (payload.method === 'ReadText' && service.getContent) {
    const result = await service.getContent({signal});
    if (!result.ok) throw new Error('Clipboard read failed: ' + result.reason);
    return result.data.get('Text');
  }
  if (payload.method === 'WriteText' && service.setContent) {
    const data = new DataPackage();
    data.setText(payload.args[0]);
    const result = await service.setContent(data, {signal});
    if (!result.ok) throw new Error('Clipboard write failed: ' + result.reason);
    return true;
  }
  throw new TypeError('Clipboard image capability is unavailable');
}

/** One debug session owns its retained host, scheduler, compositor and in-flight browser operations. */
export class StudioUIHostBridge {
  constructor(root, {request, onError = () => {}, hostOptions = {}, hostCapabilities = {}, sessionId = null, requestTimeout = 30000,
    createHost = (element, options) => new WinUIHost(element, options), schedulerOptions = {}, eventRequestOptions = {}, paused = false} = {}) {
    if (typeof request !== 'function') throw new TypeError('Studio UI bridge requires a worker request function');
    if (!Number.isFinite(requestTimeout) || requestTimeout < 1 || requestTimeout > 60000) throw new RangeError('Invalid UI host request timeout');
    this.root = root;
    this.request = request;
    this.onError = onError;
    this.hostOptions = hostOptions;
    this.hostCapabilities = hostCapabilities;
    this.createHost = createHost;
    this.schedulerOptions = schedulerOptions;
    this.requestTimeout = requestTimeout;
    this.eventRequestOptions = {timeout: Math.min(requestTimeout, 30000), ...eventRequestOptions};
    this.nextEventRequest = 1;
    this.sessionId = sessionId;
    this.pending = new Map();
    this.closed = false;
    this.paused = !!paused;
    this.install();
  }
  install() {
    this.eventRequests = new StudioUIEventClient(this, this.eventRequestOptions);
    const view = this.root.ownerDocument?.defaultView;
    this.scheduler = new FrameScheduler({requestFrame: view?.requestAnimationFrame?.bind(view),
      cancelFrame: view?.cancelAnimationFrame?.bind(view), ...this.schedulerOptions, onError: this.onError});
    this.frames = new HostUIFrameRequests(this.scheduler, {isPaused: () => this.paused});
    const input = (method, payload) => this.input(method, payload);
    this.controlServices = createControlServices(this.hostCapabilities);
    const {resources, dispose, ...controlServices} = this.controlServices;
    this.host = this.createHost(this.root, {...this.hostOptions,
      services: {...controlServices, resourceLoader: resources, ...this.hostOptions.services, scheduler: this.scheduler}, scheduler: this.scheduler,
      onEvent: (id, event, payload) => input('uiEvent', {id, event, payload}),
      onEventRequest: (id, event, payload, options) => this.requestEvent(id, event, payload, options),
      onControlStateChanged: changes => input('uiControlStateChanges', {changes}),
      onRoutedEvent: (id, event, payload) => { input('uiEvent', {id, event, payload: serializeRoutedEvent(payload)}); },
      onPrivateInput: (id, property, value) => input('uiPrivateInput', {id, property, value}),
      onCollectionInput: (id, property, items) => input('uiCollectionInput', {id, property, items}),
      onRealizeItems: ({id, indices}) => input('uiRealizeItems', {id, indices}),
      onAutomationAction: (id, method, args, pattern) => input('uiAutomationAction', {id, method, args, pattern}),
      onLayout: changes => input('uiLayout', {changes}),
      onEnvironmentSnapshot: snapshot => {
        validateEnvironmentSnapshot(snapshot);
        return input('uiEnvironmentSnapshot', {snapshot});
      },
      onLayoutSnapshot: snapshot => input('uiLayoutSnapshot', {snapshot}), onError: this.onError});
    this.composition = this.createComposition();
    this.scheduler.setPaused(this.paused);
    if (!this.paused) this.frames.resumed();
  }
  createComposition() {
    return new CompositionTransportHost({scheduler: this.scheduler, clockFactory: adapter => new AnimationClock(adapter),
      onInvalidate: () => this.host.scheduleRender(), onCompleted: value => this.send('uiCompositionCompleted', {value}),
      readProperty: (id, property) => this.host.nodes.get(id)?.properties[property.replace(/^\$/, '')],
      applyProperty: (id, property, value) => this.host.applyCompositionProperty(id, property, value),
      clearProperty: (id, property) => this.host.applyCompositionProperty(id, property, undefined),
      setElementComposition: (id, entry) => this.host.setElementComposition(id, entry),
      setBrush: (id, property, brush) => this.host.setCompositionBrush(id, property, brush)});
  }
  send(method, payload, sessionId = this.sessionId) {
    if (this.closed || !validSession(sessionId)) return false;
    try {
      assertUIHostData(payload);
      Promise.resolve(this.request(method, {...payload, sessionId})).catch(error => {
        if (!this.closed && this.sessionId === sessionId) this.onError(error);
      });
      return true;
    } catch (error) { this.onError(error); return false; }
  }
  input(method, payload) { return !this.paused && this.send(method, payload); }
  requestEvent(id, event, payload, options) { return this.eventRequests.request(id, event, payload, options); }
  setPaused(paused) {
    this.paused = !!paused;
    if (this.paused) this.eventRequests.cancelAll('The managed UI session paused');
    this.scheduler.setPaused(this.paused);
    if (!this.paused) this.frames.resumed();
    this.root.classList?.toggle('debug-paused', this.paused);
  }
  cancelPending() {
    this.eventRequests?.cancelAll('The UI scene or session changed');
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.cancel?.();
      entry.controller.abort();
    }
    this.pending.clear();
  }
  cancelRequest(requestId) {
    if (!validSession(requestId)) throw new TypeError('Invalid host cancellation identity');
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.controller.abort();
    entry.cancel?.();
    return true;
  }
  setSession(sessionId) {
    if (!validSession(sessionId)) throw new TypeError('Invalid Studio UI session identity');
    if (this.sessionId === sessionId && !this.closed) return;
    this.cancelPending();
    this.eventRequests.dispose();
    this.composition.dispose();
    this.host.dispose();
    this.controlServices.dispose();
    this.frames.dispose();
    this.scheduler.dispose();
    this.sessionId = sessionId;
    this.closed = false;
    this.install();
  }
  resetComposition() {
    this.cancelPending();
    this.composition.dispose();
    this.composition = this.createComposition();
  }
  receive(event) {
    if (!eventNames.has(event?.event)) return false;
    if (this.closed) return true;
    if (!validSession(event.sessionId)) throw new TypeError('UI event has no valid session');
    if (this.sessionId === null || typeof event.sessionId === 'number' && event.sessionId > this.sessionId) this.setSession(event.sessionId);
    if (this.closed || event.sessionId !== this.sessionId) return true;
    if (event.event === 'uiHostCancel') { this.cancelRequest(event.requestId); return true; }
    if (event.event === 'uiHostRequest') { void this.handleRequest(event); return true; }
    if (event.event === 'ui') {
      if (!Array.isArray(event.commands) || event.commands.length > 20000) throw new RangeError('UI command batch limit');
      if (event.commands.some(command => command.op === 'reset')) this.resetComposition();
      this.host.apply(event.commands);
    } else if (event.event === 'uiPrivateValues') {
      if (!Array.isArray(event.values) || event.values.length > 20000) throw new RangeError('UI private value batch limit');
      assertUIHostData(event.values);
      for (const value of event.values) {
        if (typeof value.id !== 'string' || value.property !== 'Password' || typeof value.value !== 'string') {
          throw new TypeError('Invalid private UI value');
        }
        if (value.value.length > 1048576) throw new RangeError('Private UI value size limit');
      }
      for (const value of event.values) this.host.setPrivateValue(value.id, value.property, value.value);
    } else {
      if (!Array.isArray(event.packets) || event.packets.length > 20000) throw new RangeError('Composition packet batch limit');
      for (const packet of event.packets) this.composition.receive(packet);
    }
    return true;
  }
  async execute(kind, payload, signal) {
    assertUIHostData(payload);
    if (kind === 'bindingFrame') return this.frames.request(payload, {signal});
    if (kind === 'dropFiles') {
      if (!payload || Object.keys(payload).length !== 1) throw new TypeError('Invalid file-drop request');
      validateDropToken(payload.token);
      const broker = this.host.input?.dragDrop?.files;
      if (!broker?.read) throw new TypeError('File-drop capability is unavailable');
      return broker.read(payload.token, {signal});
    }
    if (kind === 'renderToBitmap') {
      if (typeof payload.id !== 'string' || !this.host.nodes.has(payload.id)) throw new TypeError('Unknown capture target');
      if ([payload.width, payload.height].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 16384))) {
        throw new RangeError('Invalid bitmap dimensions');
      }
      if ((payload.width ?? 1) * (payload.height ?? 1) > 16777216) throw new RangeError('Bitmap pixel budget exceeded');
      return this.host.renderToBitmap(payload.id, {width: payload.width, height: payload.height, signal});
    }
    if (kind === 'control') {
      if (typeof payload.id !== 'string' || !this.host.nodes.has(payload.id)) throw new TypeError('Unknown control target');
      const result = await invokeHostControl(this.host, payload.id, payload.method, payload.args ?? []);
      if (result && Object.hasOwn(result, 'handled')) {
        if (!result.handled) throw new TypeError('Control operation was not handled');
        return result.value;
      }
      return result;
    }
    if (kind === 'clipboard') return clipboardRequest(this.host.services.clipboard, payload, signal);
    if (kind === 'launcher' && typeof payload.uri === 'string' && this.host.services.launcher?.launchUri) {
      return this.host.services.launcher.launchUri(payload.uri, {signal});
    }
    if (kind === 'window') {
      const name = Object.hasOwn(windowMethods, payload.method) ? windowMethods[payload.method] : null;
      const service = this.host.services.window;
      if (name && typeof service?.[name] === 'function' && Array.isArray(payload.args) && payload.args.length <= 2) {
        return service[name](...payload.args, {signal});
      }
    }
    throw new TypeError('Unsupported UI host capability: ' + kind);
  }
  async handleRequest(event) {
    const {requestId, sessionId} = event;
    if (!validSession(requestId) || this.pending.has(requestId)) { this.onError(new TypeError('Invalid or duplicate host request identity')); return; }
    if (this.pending.size >= 64) {
      this.send('uiHostResponse', {requestId, error: {name: 'RangeError', message: 'UI host pending-request limit exceeded'}}, sessionId);
      return;
    }
    const entry = {controller: new AbortController(), timer: null, cancel: null};
    this.pending.set(requestId, entry);
    let result = null, error = null;
    try {
      const timeout = new Promise((resolve, reject) => {
        entry.cancel = () => reject(new DOMException('UI host session ended', 'AbortError'));
        entry.timer = setTimeout(() => { entry.controller.abort(); reject(new Error('UI host request timed out')); }, this.requestTimeout);
      });
      result = await Promise.race([this.execute(event.kind, event.payload, entry.controller.signal), timeout]);
      assertUIHostData(result);
    } catch (failure) { error = {name: failure.name ?? 'Error', message: failure.message ?? String(failure)}; }
    finally { clearTimeout(entry.timer); }
    if (this.closed || sessionId !== this.sessionId || this.pending.get(requestId) !== entry) return;
    this.pending.delete(requestId);
    this.send('uiHostResponse', {requestId, result: error ? null : result ?? null, error}, sessionId);
    if (error) this.onError(new Error(error.message));
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.cancelPending();
    this.eventRequests.dispose();
    this.composition.dispose();
    this.host.dispose();
    this.controlServices.dispose();
    this.frames.dispose();
    this.scheduler.dispose();
  }
}

export function isStudioUIHostEvent(event) { return eventNames.has(event?.event); }
