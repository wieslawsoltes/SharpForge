import {ManagedFault} from '../heap.js';
import {managedDelegatesEqual} from './delegate-identity.js';

/** Ordinary CLR events occupy individual entries in the same ordered route as AddHandler subscriptions. */
export class ManagedEventSubscriptions {
  constructor(context, owner) { this.context = context; this.owner = owner; this.entries = []; }

  attach(entry) {
    const context = this.context;
    entry.dispose = context.routedEventRouter.addHandler(context.id(this.owner), entry.event, (_target, payload) => {
      const args = context.routedEventArgs(payload, {name: entry.event});
      const result = context.invokeEventHandler(entry.handler, [this.owner, args], payload);
      const finish = () => { payload.Handled = Boolean(context.native(context.read(args, 'Handled'))); };
      if (result && typeof result.then === 'function') return result.then(finish);
      finish();
    }, {handledEventsToo: false, order: entry.order});
    entry.order = entry.dispose.order;
  }

  add(event, handler) {
    if (this.entries.length >= 4096) throw new ManagedFault('ExecutionLimitException', 'UI event subscription limit');
    const entry = {event, handler};
    this.attach(entry);
    this.entries.push(entry);
  }

  remove(event, handler) {
    const index = this.entries.findLastIndex(entry => entry.event === event &&
      managedDelegatesEqual(this.context.platform, entry.handler, handler));
    if (index < 0) return;
    this.entries[index].dispose();
    this.entries.splice(index, 1);
  }

  snapshot() { return this.entries.map(({event, handler, order}) => ({event, handler, order})); }
  restore(snapshot) { this.dispose(); for (const entry of snapshot) { const restored = {...entry}; this.attach(restored); this.entries.push(restored); } }
  *retainedValues() { for (const entry of this.entries) yield entry.handler; }
  dispose() { for (const entry of this.entries) entry.dispose(); this.entries.length = 0; }
}

export function changeManagedEventSubscription(platform, reference, descriptor, handler) {
  if (handler === null) return null;
  platform.heap.get(handler);
  const key = '$event:' + descriptor.event, previous = platform.get(reference, key);
  const list = previous ? [...platform.heap.get(previous).data] : [];
  const subscriptions = platform.ui.state(reference, 'eventSubscriptions', () => new ManagedEventSubscriptions(platform.ui, reference));
  if (descriptor.kind === 'eventAdd') {
    if (list.length >= 1024) throw new ManagedFault('ExecutionLimitException', 'Event subscriber limit');
    list.push(handler);
    subscriptions.add(descriptor.event, handler);
  } else {
    const index = list.findLastIndex(candidate => managedDelegatesEqual(platform, candidate, handler));
    if (index >= 0) list.splice(index, 1);
    subscriptions.remove(descriptor.event, handler);
  }
  const data = platform.heap.allocate('array', 'object[]', list);
  platform.heap.withRoots([reference, data], () => platform.set(reference, key, data));
  platform.ui.syncOwner(reference);
  platform.command({op: 'event', id: platform.ui.id(reference), event: descriptor.event, enabled: list.length > 0});
  return null;
}

/** One dispatcher work item owns the route and all argument objects until every synchronous callback finishes. */
export function dispatchManagedRoute(context, reference, event, payload) {
  const previous = context.routeArgumentCache;
  context.routeArgumentCache = new Map();
  try {
    return context.platform.heap.withRoots([reference], () => {
      const strategy = event.startsWith('Preview') ? 'tunnel' : 'bubble';
      const result = context.routedEventRouter.raise(context.id(reference), event, payload, strategy);
      context.services.drag?.completeEvent(event, result);
      return result;
    });
  } finally { context.routeArgumentCache = previous; }
}
