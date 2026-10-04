import {eventsFor} from '@sharpforge/framework';
import {facadeRoutedEventArgs} from './event-arguments.js';

/** Ordinary events and AddHandler subscriptions occupy individual entries in the same ordered host route. */
export class FacadeEventSubscriptions {
  constructor(context, owner) { this.context = context; this.owner = owner; this.entries = []; }

  attach(entry) {
    const context = this.context;
    if (!context.routedEventRouter) throw new TypeError('The shared event router is unavailable');
    entry.dispose = context.routedEventRouter.addHandler(context.id(this.owner), entry.event, (_id, payload) => {
      const args = facadeRoutedEventArgs(context, payload);
      return context.invokeManaged(entry.handler, [this.owner, args]);
    }, {handledEventsToo: false, order: entry.order});
    entry.order = entry.dispose.order;
  }

  add(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('An event handler must be a function');
    if (this.entries.length >= 4096) throw new RangeError('UI event subscription limit');
    const entry = {event, handler};
    this.context.sceneJournal?.captureModel(this);
    this.attach(entry);
    this.entries.push(entry);
    (this.owner.$events[event] ??= []).push(handler);
  }

  remove(event, handler) {
    const index = this.entries.findLastIndex(entry => entry.event === event && entry.handler === handler);
    if (index < 0) return;
    this.context.sceneJournal?.captureModel(this);
    this.entries[index].dispose();
    this.entries.splice(index, 1);
    const values = this.owner.$events[event] ?? [];
    const current = values.lastIndexOf(handler);
    if (current >= 0) values.splice(current, 1);
  }

  snapshot() { return {version: 1, entries: this.entries.map(({event, handler, order}) => ({event, handler, order}))}; }

  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > 4096
      || snapshot.entries.some(entry => typeof entry.event !== 'string' || typeof entry.handler !== 'function'
        || !Number.isSafeInteger(entry.order) || entry.order < 1)) throw new TypeError('Invalid event subscription snapshot');
    this.dispose();
    for (const value of snapshot.entries) {
      const entry = {...value};
      this.attach(entry);
      this.entries.push(entry);
      (this.owner.$events[entry.event] ??= []).push(entry.handler);
    }
  }

  *retainedValues() { for (const entry of this.entries) yield entry.handler; }
  dispose() {
    for (const entry of this.entries) {
      entry.dispose();
      this.owner.$events[entry.event] = [];
    }
    this.entries.length = 0;
  }
}

export function subscribeFacadeEvent(context, owner, event, handler) {
  if (!Object.hasOwn(eventsFor(context.typeOf(owner)), event)) throw new TypeError('Unregistered UI event');
  const subscriptions = context.state(owner, 'facadeEvents', () => new FacadeEventSubscriptions(context, owner));
  subscriptions.add(event, handler);
  context.send({op: 'event', id: context.id(owner), event, enabled: true});
}

export function removeFacadeEvent(context, owner, event, handler) {
  const subscriptions = context.state(owner, 'facadeEvents');
  subscriptions?.remove(event, handler);
  context.send({op: 'event', id: context.id(owner), event, enabled: !!owner.$events[event]?.length});
}
