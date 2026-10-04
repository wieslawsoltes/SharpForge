import {eventsFor} from '@sharpforge/framework';
import {builtInRoutedEvents} from '@sharpforge/winui-properties';
import {DeferralGroup, serializeRoutedEvent} from '@sharpforge/winui-controls';
import {facadeControlEvent, copyFacadeEventOutcome} from './event-arguments.js';
import {prepareJavaScriptVisuals} from './services.js';

const routed = new Set([...builtInRoutedEvents, 'Click']);
const canceled = message => Object.assign(new Error(message), {name: 'AbortError', code: 'SFUI1675'});

/** The host owns the outer request deadline; this scope owns callback promises, explicit deferrals and argument lifetime. */
export class FacadeEventRequests {
  constructor(context) {
    this.context = context;
    this.pending = new Set();
    this.closed = false;
  }

  validate(id, event) {
    const {context} = this;
    if (this.closed || context.disposed || context.restoring) throw canceled('The application event scope ended or was restored');
    const owner = context.objects.get(id);
    if (!owner || !context.host.nodes.has(id)) throw canceled('The event target is no longer active');
    if (typeof event !== 'string' || !Object.hasOwn(eventsFor(context.typeOf(owner)), event)) {
      throw new TypeError('Unregistered UI input event');
    }
    if (context.read(owner, 'IsEnabled') === false || context.read(owner, 'IsHitTestVisible') === false) {
      throw new TypeError('The event target does not accept input');
    }
    return owner;
  }

  async request(id, event, payload = {}, {signal} = {}) {
    signal?.throwIfAborted();
    const owner = this.validate(id, event);
    if (this.pending.size >= 64) throw new RangeError('UI event pending-request limit');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('An event decision requires object data');
    const input = serializeRoutedEvent(payload);
    if (event === 'PasswordChanging' || event === 'PasswordChanged') { delete input.Password; delete input.value; }
    const values = {...input, OriginalSource: id};
    const controller = new AbortController();
    const group = new DeferralGroup({timeout: 30000, signal: controller.signal});
    const entry = {id, group, controller, count: 0};
    const abort = () => controller.abort(signal.reason ?? canceled('The event request was canceled'));
    signal?.addEventListener('abort', abort, {once: true});
    group.promise.catch(error => controller.abort(error));
    if (facadeControlEvent(this.context, owner, event)?.deferral) values.GetDeferral = () => {
      if (++entry.count > 64) throw new RangeError('UI event deferral limit');
      return group.getDeferral();
    };
    this.pending.add(entry);
    try {
      const strategy = event.startsWith('Preview') ? 'tunnel' : routed.has(event) ? 'bubble' : 'direct';
      const route = this.context.routedEventRouter.raiseAsync(id, event, values, strategy, {signal: controller.signal});
      const outcome = await Promise.race([route, group.promise]);
      await group.seal();
      controller.signal.throwIfAborted();
      this.validate(id, event);
      copyFacadeEventOutcome(this.context, outcome, input);
      if (event === 'DetailLabelRequested') {
        this.context.layoutTemplates.prepareDetail(owner, input);
        if (this.context.isVisual(input.Content)) prepareJavaScriptVisuals(this.context, input.Content);
        input.Content = this.context.value(input.Content);
      }
      return serializeRoutedEvent(input);
    } catch (error) {
      group.fail(error);
      throw error;
    } finally {
      this.pending.delete(entry);
      signal?.removeEventListener('abort', abort);
      controller.abort(canceled('The event decision ended'));
    }
  }

  snapshot() { return {version: 1}; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new TypeError('Invalid event request snapshot');
    this.cancelAll('The application event scope was restored');
  }
  cancelAll(message) { for (const entry of this.pending) entry.controller.abort(canceled(message)); }
  dispose() { this.closed = true; this.cancelAll('The application event scope ended'); }
}

export function requestFacadeEvent(context, id, event, payload, options) {
  const requests = context.state(null, 'facadeEventRequests', () => new FacadeEventRequests(context));
  return requests.request(id, event, payload, options);
}
