import { registerDragAdapters } from './drag-adapters.js';
import { hydratePointerEvent } from './transport.js';
import { inverseMatrix, transformPoint } from '../layout/render-properties.js';
import { registerInertiaAdapters } from './inertia-adapters.js';
import { pointerPointType, pointerPointListType, pointerPointCollectionType,
  pointerPointEnumerableType, pointerPointEnumeratorType } from '../contracts/input-payloads.js';

const input = 'Microsoft.UI.Xaml.Input.';
const pointValue = point => ({ valueType: 'Windows.Foundation.Point', X: point.X ?? point.x, Y: point.Y ?? point.y });

export function inputEventPayload(context, receiver) {
  const value = context.state(receiver, 'uiEventPayload')?.payload
    ?? context.services.layout?.pointerEvent?.(receiver) ?? context.unwrapModel(receiver);
  if (!value || typeof value !== 'object') throw new TypeError('SFUI1663: Input event payload is unavailable');
  return value;
}

function typedPointerPoint(point) {
  return { valueType: pointerPointType, ...point, Timestamp: BigInt(Math.trunc(point.Timestamp)), Position: pointValue(point.Position),
    Properties: { valueType: 'Microsoft.UI.Input.PointerPointProperties', ...point.Properties,
      ContactRect: { valueType: 'Windows.Foundation.Rect', ...point.Properties.ContactRect } } };
}

/** Typed input adapters hydrate methods at the destination; only plain data crosses a worker boundary. */
export function registerInputAdapters(registry) {
  for (const name of ['GetCurrentPoint', 'GetIntermediatePoints']) {
    registry.register({ owner: input + 'PointerRoutedEventArgs', name }, ({ context, receiver, args }) => {
      const data = inputEventPayload(context, receiver);
      const relativeId = args[0] == null ? null : context.id(args[0]);
      const service = context.services.layout;
      if (relativeId != null && !service?.getLayout) throw new Error('SFUI1663: Relative pointer coordinates require layout');
      const event = hydratePointerEvent(data, id => service?.getLayout(id));
      const result = event[name](relativeId);
      return Array.isArray(result) ? context.array(result.map(typedPointerPoint), pointerPointType)
        : context.managed(typedPointerPoint(result), pointerPointType);
    });
  }
  for (const name of ['Tapped', 'DoubleTapped', 'RightTapped', 'Holding']) {
    registry.register({ owner: input + name + 'RoutedEventArgs', name: 'GetPosition' }, ({ context, receiver, args }) => {
      const payload = inputEventPayload(context, receiver);
      const point = payload.Position ?? payload.CurrentPoint?.Position;
      if (!point || !Number.isFinite(point.X) || !Number.isFinite(point.Y)) throw new TypeError('SFUI1663: Missing gesture position');
      if (args[0] == null) return pointValue(point);
      const transform = context.services.layout?.getLayout(context.id(args[0]))?.worldTransform;
      const inverse = transform && inverseMatrix(transform);
      if (!inverse) throw new Error('SFUI1665: Relative gesture target has no invertible layout transform');
      return pointValue(transformPoint(inverse, { x: point.X, y: point.Y }));
    });
  }
  for (const name of ['Started', 'Delta']) {
    registry.register({ owner: input + 'Manipulation' + name + 'RoutedEventArgs', name: 'Complete' }, ({ context, receiver }) => {
      const payload = inputEventPayload(context, receiver);
      payload.CompleteRequested = true;
      payload.Complete?.();
      context.services.layout?.completeManipulation?.(payload.OriginalSource ?? payload.Container);
    });
  }
  for (const property of ['Mode', 'Container']) registerMutableInput(registry, 'ManipulationStartingRoutedEventArgs', property);
  registerInertiaAdapters(registry, inputEventPayload);
  registerPointCollections(registry);
  registerDragAdapters(registry);
}

function registerMutableInput(registry, type, property) {
  registry.register({ owner: input + type, name: 'set_' + property, kind: 'set' }, ({ context, receiver, args }) => {
    const payload = inputEventPayload(context, receiver);
    const value = context.native(args[0]);
    context.write(receiver, property, args[0]);
    payload[property] = property === 'Container' && args[0] != null ? context.id(args[0]) : value;
  });
}

class PointEnumerator {
  constructor(context, source) { this.context = context; this.source = source; this.index = -1; this.disposed = false; }
  get values() { if (this.disposed) throw new Error('Pointer point enumerator is disposed'); return this.context.items(this.source); }
  get Current() {
    const values = this.values;
    if (this.index < 0 || this.index >= values.length) throw new RangeError('Pointer point enumerator is not positioned');
    return values[this.index];
  }
  MoveNext() { const count = this.values.length; this.index = Math.min(this.index + 1, count); return this.index < count; }
  Reset() { this.values; this.index = -1; }
  Dispose() { this.disposed = true; }
  snapshot() { return { index: this.index, disposed: this.disposed }; }
  restore(value) { this.index = value.index; this.disposed = value.disposed; }
  retainedValues() { return this.disposed ? [] : [this.source]; }
}

function registerPointCollections(registry) {
  for (const owner of [pointerPointListType, pointerPointCollectionType]) {
    registry.register({ owner, name: 'get_Count', kind: 'get' }, ({ context, receiver }) => context.items(receiver).length);
  }
  registry.register({ owner: pointerPointCollectionType, name: 'get_IsReadOnly', kind: 'get' }, () => true);
  registry.register({ owner: pointerPointListType, name: 'get_Item', kind: 'get' }, ({ context, receiver, args }) => {
    const values = context.items(receiver);
    const index = context.native(args[0]);
    if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new RangeError('Pointer point index is out of range');
    return values[index];
  });
  for (const owner of [pointerPointListType, pointerPointEnumerableType]) {
    registry.register({ owner, name: 'GetEnumerator' }, ({ context, receiver }) => {
      return context.wrapModel(new PointEnumerator(context, receiver), pointerPointEnumeratorType);
    });
  }
  for (const name of ['MoveNext', 'Reset', 'Dispose', 'get_Current']) {
    registry.register({ owner: pointerPointEnumeratorType, name, kind: name.startsWith('get_') ? 'get' : 'method' },
      ({ context, receiver }) => {
        const model = context.unwrapModel(receiver);
        return name === 'get_Current' ? model.Current : model[name]();
      });
  }
}
