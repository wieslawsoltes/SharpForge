import { managedDataPackage } from '../app/adapters.js';
import { validateDragData, dragOperation } from './drag-data.js';
import { validateStorageDescriptors } from './drop-files.js';
import { dragVisualState } from './drag-visual.js';
import { inverseMatrix, transformPoint } from '../layout/render-properties.js';
import { storageItemType, storageListType, storageEnumerableType, storageEnumeratorType } from '../contracts/drag-input.js';

const X = 'Microsoft.UI.Xaml.', D = 'Windows.ApplicationModel.DataTransfer.';
const payloadFor = (context, receiver) => context.state(receiver, 'uiEventPayload')?.payload;
class OwnedDragValue {
  constructor(reference, source) { this.reference = reference; this.source = source; }
  snapshot() { return { reference: this.reference, source: { ...this.source } }; }
  restore(value) { this.reference = value.reference; this.source = value.source; }
  retainedValues() { return [this.reference]; }
}
class DragVisualBinding {
  constructor(payload, key) { this.payload = payload; this.key = key; this.values = dragVisualState(payload[key]); payload[key] = this.values; }
  update(property, value) { const next = dragVisualState({ ...this.values, [property]: value }); Object.assign(this.values, next); }
  clear() { this.values = dragVisualState(); this.payload[this.key] = this.values; }
  snapshot() { return { ...this.values }; }
  restore(value) { this.values = { ...value }; this.payload[this.key] = this.values; }
}
function eventData(context, receiver, property) {
  return context.state(receiver, 'drag.' + property, () => {
    const payload = payloadFor(context, receiver);
    if (!payload) throw new Error('SFUI1666: Drag event data is unavailable');
    const source = validateDragData(payload[property] ?? payload.DataView ?? payload.Data);
    const reference = context.allocate(D + (property === 'DataView' ? 'DataPackageView' : 'DataPackage'), {});
    const model = managedDataPackage(context, reference);
    model.restore(source);
    if (property === 'Data') model.onChanged = snapshot => { payload.Data = validateDragData(snapshot); };
    const owned = new OwnedDragValue(reference, source);
    context.state(reference, 'drag.storage', () => owned);
    return owned;
  }).reference;
}
function visual(context, receiver, key) {
  const state = context.state(receiver, 'drag.' + key, () => {
    const payload = payloadFor(context, receiver);
    if (!payload) throw new Error('SFUI1666: Drag event visual is unavailable');
    return new OwnedDragValue(context.wrapModel(new DragVisualBinding(payload, key), X + key), {});
  });
  return state.reference;
}

export function registerDragAdapters(registry) {
  for (const owner of [X + 'DragStartingEventArgs', X + 'DragEventArgs']) {
    for (const property of owner.endsWith('StartingEventArgs') ? ['Data'] : ['Data', 'DataView']) {
      registry.register({ owner, name: 'get_' + property, kind: 'get' }, ({ context, receiver }) => eventData(context, receiver, property));
    }
    const key = owner.endsWith('StartingEventArgs') ? 'DragUI' : 'DragUIOverride';
    registry.register({ owner, name: 'get_' + key, kind: 'get' }, ({ context, receiver }) => visual(context, receiver, key));
    registry.register({ owner, name: 'GetPosition' }, ({ context, receiver, args }) => {
      const point = payloadFor(context, receiver)?.Position;
      if (!point || ![point.X, point.Y].every(Number.isFinite)) throw new Error('SFUI1666: Drag position is unavailable');
      let result = { x: point.X, y: point.Y };
      if (args[0] != null) {
        const matrix = context.services.layout?.getLayout(context.id(args[0]))?.worldTransform;
        const inverse = matrix && inverseMatrix(matrix);
        if (!inverse) throw new Error('SFUI1665: Relative drag target has no invertible transform');
        result = transformPoint(inverse, result);
      }
      return { valueType: 'Windows.Foundation.Point', X: result.x, Y: result.y };
    });
    registry.register({ owner, name: 'GetDeferral' }, ({ context, receiver }) => {
      const model = context.services.drag?.getDeferral(payloadFor(context, receiver));
      if (!model) throw new Error('SFUI1668: The host cannot defer this drag event');
      return context.wrapModel(model, X + 'DragOperationDeferral');
    });
  }
  for (const [owner, properties] of [[X + 'DragStartingEventArgs', ['Cancel', 'AllowedOperations']],
    [X + 'DragEventArgs', ['AcceptedOperation']]]) for (const property of properties) {
    registry.register({ owner, name: 'set_' + property, kind: 'set' }, ({ context, receiver, args }) => {
      const value = property === 'Cancel' ? !!context.native(args[0]) : dragOperation(context.native(args[0]));
      context.write(receiver, property, value);
      payloadFor(context, receiver)[property] = value;
    });
  }
  registry.register({ owner: X + 'DragEventArgs', name: 'set_Data', kind: 'set' }, ({ context, receiver, args }) => {
    payloadFor(context, receiver).Data = validateDragData(managedDataPackage(context, args[0]).snapshot());
  });
  registry.register({ owner: X + 'DragOperationDeferral', name: 'Complete' }, ({ context, receiver }) => context.unwrapModel(receiver).Complete());
  registerDragVisualAdapters(registry);
  registerStorageAdapters(registry);
}

function registerDragVisualAdapters(registry) {
  for (const property of ['Caption', 'IsCaptionVisible', 'IsContentVisible', 'IsGlyphVisible']) {
    registry.register({ owner: X + 'DragUIOverride', name: 'get_' + property, kind: 'get' },
      ({ context, receiver }) => context.unwrapModel(receiver).values[property]);
    registry.register({ owner: X + 'DragUIOverride', name: 'set_' + property, kind: 'set' },
      ({ context, receiver, args }) => context.unwrapModel(receiver).update(property, context.native(args[0])));
  }
  registry.register({ owner: X + 'DragUIOverride', name: 'Clear' }, ({ context, receiver }) => context.unwrapModel(receiver).clear());
  for (const owner of [X + 'DragUI', X + 'DragUIOverride']) registry.register({ owner, name: 'SetContentFromBitmapImage' },
    ({ context, receiver, args }) => {
      const model = context.unwrapModel(receiver);
      model.values.Bitmap = context.id(args[0]);
      model.values.Anchor = args[1] == null ? { X: 0, Y: 0 } : context.native(args[1]);
      dragVisualState(model.values);
    });
}

class StorageItemRecord {
  constructor(value) { this.value = validateStorageDescriptors([value])[0]; }
  snapshot() { return this.value; }
  restore(value) { this.value = validateStorageDescriptors([value])[0]; }
}

class StorageEnumerator {
  constructor(context, owner) { this.context = context; this.owner = owner; this.index = -1; this.disposed = false; }
  values() { if (this.disposed) throw new Error('Storage item enumerator is disposed'); return this.context.items(this.owner); }
  MoveNext() { this.index++; return this.index < this.values().length; }
  get Current() { const values = this.values(); if (this.index < 0 || this.index >= values.length) throw new RangeError('Invalid position');
    return values[this.index]; }
  Reset() { this.values(); this.index = -1; }
  Dispose() { this.disposed = true; }
  snapshot() { return { index: this.index, disposed: this.disposed }; }
  restore(value) { Object.assign(this, value); }
  retainedValues() { return this.disposed ? [] : [this.owner]; }
}
function registerStorageAdapters(registry) {
  registry.register({ owner: D + 'DataPackageView', name: 'GetStorageItemsAsync' }, ({ context, receiver }) => {
    const source = context.state(receiver, 'drag.storage')?.source;
    if (!context.services.drag) throw new Error('SFUI1667: Storage drops require an explicit host capability');
    return context.task(context.services.drag.storageItems(source).then(items => context.array(items.map(item => {
      const reference = context.allocate('Windows.Storage.StorageFile', { Name: item.name, Path: '', ContentType: item.contentType,
        FileType: item.name.includes('.') ? '.' + item.name.split('.').at(-1) : '' });
      context.state(reference, 'storage.item', () => new StorageItemRecord(item));
      return reference;
    }), storageItemType)), { resultType: storageListType });
  });
  registry.register({ owner: storageListType, name: 'get_Count', kind: 'get' }, ({ context, receiver }) => context.items(receiver).length);
  registry.register({ owner: storageListType, name: 'get_Item', kind: 'get' }, ({ context, receiver, args }) => {
    const index = context.native(args[0]), values = context.items(receiver);
    if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new RangeError('Storage item index is out of range');
    return values[index];
  });
  for (const owner of [storageListType, storageEnumerableType]) registry.register({ owner, name: 'GetEnumerator' },
    ({ context, receiver }) => context.wrapModel(new StorageEnumerator(context, receiver), storageEnumeratorType));
  for (const name of ['MoveNext', 'Reset', 'Dispose', 'get_Current']) {
    registry.register({ owner: storageEnumeratorType, name, kind: name.startsWith('get_') ? 'get' : 'method' },
      ({ context, receiver }) => name === 'get_Current' ? context.unwrapModel(receiver).Current : context.unwrapModel(receiver)[name]());
  }
}
