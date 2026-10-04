export const builtInRoutedEvents = Object.freeze([
  'Tapped', 'DoubleTapped', 'RightTapped', 'Holding', 'PointerEntered', 'PointerExited', 'PointerMoved',
  'PointerPressed', 'PointerReleased', 'PointerCanceled', 'PointerCaptureLost', 'PointerWheelChanged',
  'KeyDown', 'KeyUp', 'PreviewKeyDown', 'PreviewKeyUp', 'GettingFocus', 'LosingFocus', 'GotFocus', 'LostFocus',
  'DragEnter', 'DragLeave', 'DragOver', 'Drop', 'ManipulationStarting', 'ManipulationStarted',
  'ManipulationDelta', 'ManipulationInertiaStarting', 'ManipulationCompleted', 'BringIntoViewRequested'
]);

/** Stable session-owned RoutedEvent identities; route construction belongs to the shared A16 input router. */
export class RoutedEventRegistry {
  constructor({isAssignable = (target, source) => target === source || target === 'object', maxEvents = 10000} = {}) {
    this.isAssignable = isAssignable;
    this.maxEvents = maxEvents;
    this.events = new Map();
    this.byId = new Map();
    this.nextId = 1;
  }

  register({name, ownerType, handlerType = 'object', routingStrategy = 'bubble'}) {
    if (!name || !ownerType || !['direct', 'bubble', 'tunnel'].includes(routingStrategy)) throw new TypeError('Invalid routed event metadata.');
    const key = ownerType + ':' + name;
    if (this.events.has(key)) throw new TypeError('Duplicate routed event registration.');
    if (this.events.size >= this.maxEvents) throw new RangeError('Routed event registration budget exceeded.');
    const event = Object.freeze({kind: 'RoutedEvent', id: this.nextId++, name, ownerType, handlerType, routingStrategy, reconstructible: true});
    this.events.set(key, event);
    this.byId.set(event.id, event);
    return event;
  }

  lookup(ownerType, name) { return this.events.get(ownerType + ':' + name) ?? null; }
  resolve(event) {
    if (!event || this.byId.get(event.id) !== event) throw new TypeError('A registered routed event identity is required.');
    return event;
  }
  snapshot() { return {events: [...this.events], nextId: this.nextId}; }
  restore(snapshot) {
    this.events = new Map(snapshot.events);
    this.byId = new Map([...this.events.values()].map(event => [event.id, event]));
    this.nextId = snapshot.nextId;
  }
  dispose() { this.events.clear(); this.byId.clear(); }
}
