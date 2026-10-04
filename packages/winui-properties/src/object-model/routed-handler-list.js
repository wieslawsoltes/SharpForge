import {ResourceFault} from '../resources/errors.js';

/** Owner-local managed handler roots project onto the single host router. Removing a delegate removes its latest registration. */
export class RoutedHandlerList {
  constructor({context, owner}) {
    if (!context.routedEventRouter) throw new ResourceFault('SFROUTE002', 'This host does not provide the shared routed-event router.');
    this.context = context;
    this.owner = owner;
    this.entries = [];
  }

  add(event, handler, handledEventsToo, order = undefined) {
    if (handler === null || handler === undefined) throw new TypeError('A routed-event handler is required.');
    const entry = {event, handler, handledEventsToo, order, dispose: null};
    this.attach(entry);
    this.entries.push(entry);
  }

  attach(entry) {
    const context = this.context;
    entry.dispose = context.routedEventRouter.addHandler(context.id(this.owner), entry.event.name, (_target, payload) => {
      if (!context.routedEventArgs) throw new ResourceFault('SFROUTE003', 'The host has no managed routed-event argument adapter.');
      const args = context.routedEventArgs(payload, entry.event);
      const result = context.invokeEventHandler
        ? context.invokeEventHandler(entry.handler, [this.owner, args], payload)
        : context.invokeManaged(entry.handler, [this.owner, args]);
      const finish = () => { payload.Handled = Boolean(context.native(context.read(args, 'Handled'))); };
      if (result && typeof result.then === 'function') return result.then(finish);
      finish();
    }, {handledEventsToo: entry.handledEventsToo, order: entry.order});
    entry.order = entry.dispose.order;
  }

  remove(event, handler) {
    const matches = this.context.equals ?? Object.is;
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (entry.event !== event || !matches(entry.handler, handler)) continue;
      entry.dispose();
      this.entries.splice(index, 1);
      return;
    }
  }

  snapshot() { return {entries: this.entries.map(({event, handler, handledEventsToo, order}) => ({event, handler, handledEventsToo, order}))}; }
  restore(snapshot) {
    this.dispose();
    for (const entry of snapshot.entries) this.add(entry.event, entry.handler, entry.handledEventsToo, entry.order);
  }
  *retainedValues() { yield this.owner; for (const entry of this.entries) yield entry.handler; }
  dispose() { for (const entry of this.entries) entry.dispose(); this.entries.length = 0; }
}
