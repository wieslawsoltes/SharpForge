import {eventsFor} from '@sharpforge/framework';
import {DeferralGroup, serializeRoutedEvent} from '@sharpforge/winui-controls';
import {builtInRoutedEvents} from '@sharpforge/winui-properties';
import {ManagedFault, isReference} from '../heap.js';
import {frameworkDefinition} from './object-storage.js';
import {managedEventArguments, managedControlEvent, copyManagedEventOutcome} from './events.js';
import {invokeRequestedEventCallback} from './event-request-callback.js';
import {prepareManagedVisuals} from './tree-services.js';

const routed = new Set([...builtInRoutedEvents, 'Click']);
const canceled = message => new ManagedFault('OperationCanceledException', message);

/** Pending native decisions retain managed arguments only until their handlers and explicit deferrals finish. */
export class ManagedEventRequests {
  constructor(context) {
    this.context = context;
    this.marker = Symbol('managed event request');
    this.pending = new Set();
    this.closed = false;
  }

  validate(receiver, event) {
    const {context} = this;
    if (this.closed || context.work.closed) throw canceled('The managed UI session ended');
    if (context.platform.vm.state === 'paused') {
      throw new ManagedFault('InvalidOperationException', 'Continue execution before interacting with the managed application');
    }
    if (context.platform.vm.state === 'faulted') throw new ManagedFault('InvalidOperationException', 'The managed application has faulted');
    const id = context.id(receiver);
    const definition = frameworkDefinition(context.platform, context.typeOf(receiver));
    if (typeof event !== 'string' || !Object.hasOwn(eventsFor(definition?.name), event)) {
      throw new ManagedFault('InvalidOperationException', 'Unregistered UI event');
    }
    if (!context.platform.scene().nodes.some(node => node.id === id)) {
      throw new ManagedFault('InvalidOperationException', 'Event target is not active');
    }
    if (!context.native(context.read(receiver, 'IsEnabled') ?? true)
      || !context.native(context.read(receiver, 'IsHitTestVisible') ?? true)) {
      throw new ManagedFault('InvalidOperationException', 'The event target does not accept input');
    }
    return id;
  }

  create(receiver, event, payload, {signal, timeout = 30000}) {
    signal?.throwIfAborted();
    const id = this.validate(receiver, event);
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 30000) throw new RangeError('Invalid event decision timeout');
    if (this.pending.size >= 64) throw new ManagedFault('ExecutionLimitException', 'Managed UI event request limit');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('An event decision requires object data');
    const values = serializeRoutedEvent(payload);
    if (event === 'PasswordChanging' || event === 'PasswordChanged') {
      delete values.Password;
      delete values.value;
    }
    const supportsDeferral = managedControlEvent(this.context, receiver, event)?.deferral;
    const controller = new AbortController();
    const entry = {receiver, event, id, values, controller, arguments: new Map(), roots: [receiver], deferrals: 0, group: null};
    const abort = () => controller.abort(signal.reason ?? canceled('The event decision was canceled'));
    signal?.addEventListener('abort', abort, {once: true});
    entry.releaseSignal = () => signal?.removeEventListener('abort', abort);
    entry.group = new DeferralGroup({timeout, signal: controller.signal});
    entry.group.promise.catch(error => controller.abort(error));
    if (supportsDeferral) {
      values.GetDeferral = () => {
        if (++entry.deferrals > 64) throw new ManagedFault('ExecutionLimitException', 'Event deferral limit');
        return entry.group.getDeferral();
      };
    }
    values[this.marker] = entry;
    this.pending.add(entry);
    return entry;
  }

  owns(payload) {
    const entry = payload?.[this.marker];
    return !!entry && this.pending.has(entry);
  }

  argumentsFor(payload, event) {
    const entry = payload?.[this.marker];
    if (!entry || !this.pending.has(entry)) return null;
    let args = entry.arguments.get(payload);
    if (!args) {
      args = managedEventArguments(this.context, entry.receiver, event.name, payload);
      entry.arguments.set(payload, args);
      entry.roots.push(args);
    } else if (payload.Source && this.context.propertiesFor(this.context.typeOf(args)).Source) {
      this.context.write(args, 'Source', this.context.reference(payload.Source));
    }
    return args;
  }

  invoke(handler, args, payload) {
    const entry = payload?.[this.marker];
    if (!entry || !this.pending.has(entry)) throw canceled('The event decision is no longer active');
    return invokeRequestedEventCallback(this.context, entry, handler, args);
  }

  async request(receiver, event, payload = {}, options = {}) {
    const entry = this.create(receiver, event, payload, options);
    const {context} = this;
    try {
      const strategy = event.startsWith('Preview') ? 'tunnel' : routed.has(event) ? 'bubble' : 'direct';
      const route = strategy === 'direct' ? [entry.id] : context.routedEventRouter.path(entry.id);
      for (const id of route) entry.roots.push(context.reference(id));
      await context.routedEventRouter.raiseAsync(entry.id, event, entry.values, strategy, {signal: entry.controller.signal});
      await entry.group.seal();
      entry.controller.signal.throwIfAborted();
      this.validate(receiver, event);
      const result = serializeRoutedEvent(entry.values);
      for (const args of entry.arguments.values()) copyManagedEventOutcome(context, args, result);
      if (event === 'DetailLabelRequested') {
        context.layoutTemplates.prepareDetail(receiver, result);
        if (context.isVisual(result.Content)) prepareManagedVisuals(context, result.Content);
      }
      for (const [name, value] of Object.entries(result)) if (isReference(value)) result[name] = context.platform.exportValue(value);
      return serializeRoutedEvent(result);
    } catch (error) {
      entry.group.fail(error);
      throw error;
    } finally {
      this.pending.delete(entry);
      entry.releaseSignal();
      entry.controller.abort(canceled('The event decision ended'));
      entry.arguments.clear();
      entry.roots.length = 0;
    }
  }

  *retainedValues() { for (const entry of this.pending) yield* entry.roots; }
  snapshot() { return {version: 1}; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ManagedFault('ArgumentException', 'Invalid event request snapshot');
    this.cancelAll('The managed UI session was rewound');
  }
  cancelAll(message) {
    for (const entry of this.pending) entry.controller.abort(canceled(message));
    this.pending.clear();
  }
  dispose() { this.closed = true; this.cancelAll('The managed UI session ended'); }
}
