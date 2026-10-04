import {eventsFor, frameworkType, XAML} from '@sharpforge/framework';
import {controlFamilyEventContracts, hydratePointerEvent, serializeRoutedEvent, applyControlFamilyInput,
  dragArgumentTypes} from '@sharpforge/winui-controls';
import {builtInRoutedEvents} from '@sharpforge/winui-properties';
import {createCanvasDrawEvent} from '@sharpforge/rendering';
import {ManagedFault, isReference} from '../heap.js';
import {frameworkDefinition} from './object-storage.js';
import {dispatchManagedRoute} from './event-subscriptions.js';

const routedNames = new Set([...builtInRoutedEvents, 'Click']);

const mutable = ['Cancel', 'Handled', 'CanExecute', 'IsBlackout', 'State', 'AcceptedOperation', 'AllowedOperations', 'Content'];
const inputProperties = Object.freeze({TextChanged: 'Text', Toggled: 'IsOn', Checked: 'IsChecked', Unchecked: 'IsChecked',
  ValueChanged: 'Value', SelectionChanged: 'SelectedIndex', Expanding: 'IsExpanded', Collapsed: 'IsExpanded',
  DateChanged: 'Date', TimeChanged: 'Time'});

class EventPayload {
  constructor(payload) { this.payload = payload; }
  snapshot() { return {...this.payload}; }
  restore(snapshot) { Object.assign(this.payload, snapshot); }
  retainedValues() { return Object.values(this.payload); }
}

class EventDeferral {
  constructor(deferral) { this.deferral = deferral; this.completed = false; }
  complete() {
    if (this.completed) throw new ManagedFault('InvalidOperationException', 'The event deferral was already completed');
    this.completed = true;
    const method = this.deferral.Complete ?? this.deferral.complete;
    if (typeof method !== 'function') throw new ManagedFault('InvalidOperationException', 'Invalid event deferral');
    method.call(this.deferral);
  }
  snapshot() { return {completed: this.completed}; }
  restore(snapshot) { this.completed = snapshot.completed; }
}

export function registerManagedEventAdapters(registry) {
  const owners = new Set([...controlFamilyEventContracts.values()].filter(event => event.deferral).map(event => event.type));
  for (const owner of owners) registry.register({owner, name: 'GetDeferral'}, ({context, receiver}) => {
    const payload = context.state(receiver, 'uiEventPayload')?.payload;
    const get = payload?.GetDeferral ?? payload?.getDeferral;
    if (typeof get !== 'function') throw new ManagedFault('InvalidOperationException', 'This event does not support deferrals');
    const model = new EventDeferral(get.call(payload));
    const reference = context.allocate('Windows.Foundation.Deferral');
    context.state(reference, 'uiDeferral', () => model);
    return reference;
  });
  registry.register({owner: 'Windows.Foundation.Deferral', name: 'Complete'}, ({context, receiver}) => {
    const deferral = context.state(receiver, 'uiDeferral');
    if (!deferral) throw new ManagedFault('InvalidOperationException', 'Unknown event deferral');
    deferral.complete();
  });
}

export function managedControlEvent(context, receiver, event) {
  let type = context.typeOf(receiver);
  const seen = new Set();
  while (type && !seen.has(type)) {
    seen.add(type);
    const family = controlFamilyEventContracts.get(type + '::' + event);
    if (family) return family;
    type = context.platform.heap.methodTables.get(type).base?.name;
  }
  return null;
}

export function managedEventType(context, receiver, event) {
  if (dragArgumentTypes[event]) return dragArgumentTypes[event];
  const family = managedControlEvent(context, receiver, event);
  if (family) return family.type;
  if (/^(Preview)?Pointer/.test(event)) return XAML + 'Input.PointerRoutedEventArgs';
  if (/^(Preview)?Key/.test(event)) return XAML + 'Input.KeyRoutedEventArgs';
  const owner = frameworkDefinition(context.platform, context.typeOf(receiver))?.name;
  const definition = eventsFor(owner)[event];
  const signature = frameworkType(definition?.delegate ?? definition);
  return signature?.parameters?.[1] ?? XAML + 'RoutedEventArgs';
}

function payloadValue(context, value, type) {
  if (typeof value === 'string' && type !== 'string' && type !== 'object') {
    if (frameworkType(type)?.kind === 'enum') return frameworkType(type).values[value] ?? value;
    if (/^\d+:\d+$/.test(value)) return context.reference(value);
  }
  if (value?.$ref) return context.reference(value.$ref);
  if (value && typeof value === 'object' && !Array.isArray(value) && !isReference(value)) {
    const fields = context.propertiesFor(type);
    if (Object.keys(fields).length) return context.allocate(type, Object.fromEntries(Object.keys(fields)
      .filter(name => Object.hasOwn(value, name) || Object.hasOwn(value, name[0].toLowerCase() + name.slice(1)))
      .map(name => [name, payloadValue(context, value[name] ?? value[name[0].toLowerCase() + name.slice(1)], fields[name].type)])));
  }
  return context.managed(value, type);
}

export function managedEventArguments(context, receiver, event, payload = {}) {
  if (payload.CurrentPoint) payload = hydratePointerEvent(payload, id => context.services.layout?.getLayout(id));
  const type = managedEventType(context, receiver, event);
  const fields = context.propertiesFor(type), values = {OriginalSource: receiver, Handled: false};
  const roots = [receiver];
  return context.platform.heap.withRoots(roots, () => {
    for (const [name, definition] of Object.entries(fields)) {
      if (!Object.hasOwn(payload, name)) continue;
      const value = (name === 'OriginalSource' || name === 'Source') && typeof payload[name] === 'string'
        ? {$ref: payload[name]} : payload[name];
      values[name] = payloadValue(context, value, definition.type);
      context.platform.heap.pins.push(values[name]);
    }
    const reference = context.allocate(type, values);
    context.platform.heap.pins.push(reference);
    context.state(reference, 'uiEventPayload', () => new EventPayload(payload));
    return reference;
  });
}

/** Model events complete their synchronous cancellation phase before the model continues. */
export function emitManagedEvent(context, receiver, event, payload = {}, {enqueue = false} = {}) {
  if (routedNames.has(event)) {
    if (enqueue) return [context.work.enqueue(() => dispatchManagedRoute(context, receiver, event, payload), [receiver])];
    Object.assign(payload, dispatchManagedRoute(context, receiver, event, payload));
    return payload;
  }
  if (enqueue && dragArgumentTypes[event]) {
    return [context.work.enqueue(() => emitManagedEvent(context, receiver, event, payload), [receiver])];
  }
  const platform = context.platform;
  const list = platform.get(receiver, '$event:' + event);
  const handlers = list ? [...platform.heap.get(list).data] : [];
  const result = [];
  platform.heap.withRoots([receiver, ...handlers], () => {
    const canvas = event === 'Draw' ? createCanvasDrawEvent(context, receiver) : null;
    const args = canvas?.args ?? managedEventArguments(context, receiver, event, payload);
    platform.heap.pins.push(args);
    try {
      for (const handler of handlers) {
        if (enqueue && !canvas) result.push(platform.vm.scheduler.enqueue(handler, [receiver, args], {kind: 'ui', name: event}));
        else context.invokeManaged(handler, [receiver, args]);
      }
      if (!enqueue) copyManagedEventOutcome(context, args, payload);
      if (canvas) {
        const displayList = canvas.complete();
        platform.command({op: 'displayList', id: context.id(receiver), displayList: displayList.serialize?.() ?? displayList});
      }
      if (!enqueue) context.services.drag?.completeEvent(event, payload);
    } finally { canvas?.dispose(); }
  });
  return enqueue ? result : payload;
}

/** Only decision fields are writable outcomes; proposed text, identity, position and reason remain input data. */
export function copyManagedEventOutcome(context, args, payload) {
  const properties = context.propertiesFor(context.typeOf(args));
  for (const name of mutable) {
    if (!properties[name] || properties[name].readOnly) continue;
    const value = context.native(context.read(args, name));
    payload[name] = ['bool', 'System.Boolean'].includes(properties[name].type) ? Boolean(value) : value;
  }
  return payload;
}

export function dispatchManagedEvent(platform, id, event, payload = {}) {
  if (typeof event !== 'string' || !payload || typeof payload !== 'object') throw new TypeError('Invalid UI event');
  const context = platform.ui, reference = context.reference(id);
  const definition = frameworkDefinition(platform, context.typeOf(reference));
  if (!Object.hasOwn(eventsFor(definition?.name), event)) throw new ManagedFault('InvalidOperationException', 'Unregistered UI event');
  if (!platform.scene().nodes.some(node => node.id === id)) {
    throw new ManagedFault('InvalidOperationException', 'Event target is not in the active visual tree');
  }
  if (!context.native(context.read(reference, 'IsEnabled') ?? true) || !context.native(context.read(reference, 'IsHitTestVisible') ?? true)) return [];
  const values = serializeRoutedEvent(payload);
  if (/^PasswordChang/.test(event)) { delete values.value; delete values.Password; }
  if (event === 'TextChanged' && (Object.hasOwn(values, 'Text') || Object.hasOwn(values, 'value'))
    && typeof (values.Text ?? values.value) !== 'string') throw new TypeError('Invalid input text');
  const handledInput = applyControlFamilyInput(context, reference, event, values, {emit: false});
  const property = inputProperties[event];
  if (!handledInput && property && Object.hasOwn(values, 'value')) context.write(reference, property, values.value);
  if (values.CollectionProperty && Array.isArray(values.Items)) context.collectionInput(reference, values.CollectionProperty, values.Items);
  if (event === 'LostFocus') context.bindings.LostFocus(context.storeFor(reference));
  if (values.Pointer || values.CurrentPoint) context.services.layout?.observePointer?.(values, event);
  context.services.layout?.observeScrollEvent?.(reference, event, values);
  if (routedNames.has(event) || Array.isArray(values.Route)) {
    return [context.work.enqueue(() => dispatchManagedRoute(context, reference, event, values), [reference])];
  }
  return emitManagedEvent(context, reference, event, values, {enqueue: true});
}
