import {eventsFor} from '@sharpforge/framework';
import {builtInRoutedEvents} from '@sharpforge/winui-properties';
import {applyControlFamilyInput, observeLayoutControlEvent, serializeRoutedEvent} from '@sharpforge/winui-controls';
import {createCanvasDrawEvent} from '@sharpforge/rendering';
import {facadeRoutedEventArgs, facadeEventPayload, copyFacadeEventOutcome} from './event-arguments.js';
export {facadeRoutedEventArgs};
export {subscribeFacadeEvent, removeFacadeEvent} from './event-subscriptions.js';

const routedEvents = new Set([...builtInRoutedEvents, 'Click']);
const eventProperties = Object.freeze({
  TextChanged: 'Text', ValueChanged: 'Value', SelectionChanged: 'SelectedIndex', Checked: 'IsChecked',
  Unchecked: 'IsChecked', Toggled: 'IsOn', DateChanged: 'Date', TimeChanged: 'Time', Expanding: 'IsExpanded', Collapsed: 'IsExpanded'
});

/** Resolve host IDs to application objects and apply edits through property notifications. */
export function dispatchFacadeEvent(context, id, event, payload = {}) {
  const object = context.objects.get(id);
  if (!object || context.disposed) return;
  if (!Object.hasOwn(eventsFor(context.typeOf(object)), event)) throw new TypeError('Unregistered UI input event');
  if (context.read(object, 'IsEnabled') === false || context.read(object, 'IsHitTestVisible') === false) return;
  const values = serializeRoutedEvent(payload);
  for (const name of ['GetDeferral', 'getDeferral']) {
    if (typeof payload[name] === 'function') values[name] = payload[name].bind(payload);
  }
  if (event === 'PasswordChanged' || event === 'PasswordChanging') { delete values.value; delete values.Password; }
  const handled = applyControlFamilyInput(context, object, event, values, {emit: false});
  observeLayoutControlEvent(context, object, event, values);
  const property = eventProperties[event];
  if (!handled && property && Object.hasOwn(values, 'value')) context.styles.set(object, property, values.value);
  if (values.CollectionProperty && Array.isArray(values.Items)) context.collectionInput(object, values.CollectionProperty, values.Items);
  return emitFacadeEvent(context, object, event, values);
}

/** Model-originated events complete their synchronous route and cancellation phase before the model resumes. */
export function emitFacadeEvent(context, receiver, event, values = {}) {
  if (context.restoring || context.disposed) return values;
  const id = context.id(receiver);
  const canvas = event === 'Draw' ? createCanvasDrawEvent(context, receiver) : null;
  const initial = {...values, OriginalSource: values.OriginalSource ?? id};
  const payload = canvas ? facadeEventPayload(context, initial, canvas.args) : initial;
  if (event === 'PasswordChanged' || event === 'PasswordChanging') { delete payload.value; delete payload.Password; }
  const strategy = event.startsWith('Preview') ? 'tunnel' : routedEvents.has(event) ? 'bubble' : 'direct';
  try {
    if (!context.routedEventRouter) throw new TypeError('The shared event router is unavailable');
    const result = context.routedEventRouter.raise(id, event, payload, strategy) ?? payload;
    const args = facadeRoutedEventArgs(context, result);
    if (canvas) context.send({op: 'displayList', id, displayList: canvas.complete().serialize()});
    copyFacadeEventOutcome(context, result, values);
    return args;
  } finally { canvas?.dispose(); }
}

/** The host calls this after routing; it must not route the event for a second time. */
export function completeFacadeRoute(context, id, event, payload) {
  const owner = context.objects.get(id);
  if (!owner || context.disposed || context.restoring) return payload;
  const args = facadeRoutedEventArgs(context, payload);
  try { context.options.onEvent?.(id, event, args); }
  finally { context.services.drag?.completeEvent(event, payload); }
  return payload;
}

/** Password text is sent directly to the owning application state, outside event payloads. */
export function dispatchPrivateInput(context, id, property, value) {
  const object = context.objects.get(id);
  if (!object || !object.$node.type.endsWith('.PasswordBox') || property !== 'Password' || typeof value !== 'string') {
    throw new TypeError('Invalid private control input');
  }
  applyControlFamilyInput(context, object, 'PasswordChanged', value, {privateInput: true, emit: false});
  context.options.onPrivateInput?.(id, property, value);
}

export function updateFacadeLayout(context, changes) {
  for (const change of changes) {
    const object = context.objects.get(change.id);
    if (!object) continue;
    if (context.styles.setReadOnly) {
      context.styles.setReadOnly(object, 'ActualWidth', change.width);
      context.styles.setReadOnly(object, 'ActualHeight', change.height);
    } else {
      object.$values.ActualWidth = change.width;
      object.$values.ActualHeight = change.height;
    }
  }
  context.options.onLayout?.(changes);
}
