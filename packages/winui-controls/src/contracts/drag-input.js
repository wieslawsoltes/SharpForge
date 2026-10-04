import { addType, addProperty, addMethod, addEvent } from './contract-registration.js';

const X = 'Microsoft.UI.Xaml.', D = 'Windows.ApplicationModel.DataTransfer.';
export const storageItemType = 'Windows.Storage.IStorageItem';
export const storageListType = 'System.Collections.Generic.IReadOnlyList`1<' + storageItemType + '>';
export const storageEnumerableType = 'System.Collections.Generic.IEnumerable`1<' + storageItemType + '>';
export const storageEnumeratorType = 'System.Collections.Generic.IEnumerator`1<' + storageItemType + '>';
export const dragArgumentTypes = Object.freeze({ DragStarting: X + 'DragStartingEventArgs',
  DragEnter: X + 'DragEventArgs', DragOver: X + 'DragEventArgs', DragLeave: X + 'DragEventArgs', Drop: X + 'DragEventArgs',
  DropCompleted: X + 'DropCompletedEventArgs' });

export function registerDragContracts(registry) {
  if (!registry.types.has(D + 'DataPackageOperation')) registry.en(D + 'DataPackageOperation', { None: 0, Copy: 1, Move: 2, Link: 4 });
  if (!registry.types.has('Windows.ApplicationModel.DataTransfer.DragDrop.DragDropModifiers')) {
    registry.en('Windows.ApplicationModel.DataTransfer.DragDrop.DragDropModifiers',
      { None: 0, LeftButton: 1, RightButton: 2, Shift: 4, Control: 8, MiddleButton: 16, Alt: 32 });
  }
  registry.types.get(D + 'DataPackageOperation').flags = true;
  registry.types.get('Windows.ApplicationModel.DataTransfer.DragDrop.DragDropModifiers').flags = true;
  for (const name of ['DataPackage', 'DataPackageView']) addType(registry, D + name, { kind: 'object' });
  for (const name of new Set(Object.values(dragArgumentTypes))) addType(registry, name, { kind: 'object', base: X + 'RoutedEventArgs' }, []);
  for (const [event, argument] of Object.entries(dragArgumentTypes)) {
    const delegate = X + (argument === X + 'DragEventArgs' ? 'DragEventHandler' : event + 'EventHandler');
    if (!registry.types.has(delegate)) registry.delegate(delegate, ['object', argument]);
    addEvent(registry, X + 'UIElement', event, delegate);
  }
  const starting = X + 'DragStartingEventArgs', drag = X + 'DragEventArgs';
  addProperty(registry, starting, 'Cancel', 'bool', false);
  addProperty(registry, starting, 'AllowedOperations', D + 'DataPackageOperation', 7);
  addProperty(registry, starting, 'Data', D + 'DataPackage', null, true);
  addProperty(registry, starting, 'DragUI', X + 'DragUI', null, true);
  addProperty(registry, drag, 'Data', D + 'DataPackage');
  addProperty(registry, drag, 'DataView', D + 'DataPackageView', null, true);
  addProperty(registry, drag, 'AllowedOperations', D + 'DataPackageOperation', 0, true);
  addProperty(registry, drag, 'AcceptedOperation', D + 'DataPackageOperation', 0);
  addProperty(registry, drag, 'Modifiers', 'Windows.ApplicationModel.DataTransfer.DragDrop.DragDropModifiers', 0, true);
  addProperty(registry, drag, 'DragUIOverride', X + 'DragUIOverride', null, true);
  addProperty(registry, X + 'DropCompletedEventArgs', 'DropResult', D + 'DataPackageOperation', 0, true);
  addType(registry, X + 'DragOperationDeferral', { kind: 'object' }, []);
  addMethod(registry, X + 'DragOperationDeferral', 'Complete', []);
  for (const owner of [starting, drag]) {
    addMethod(registry, owner, 'GetPosition', [X + 'UIElement'], 'Windows.Foundation.Point');
    addMethod(registry, owner, 'GetDeferral', [], X + 'DragOperationDeferral');
  }
  for (const name of ['DragUI', 'DragUIOverride']) addType(registry, X + name, { kind: 'object' }, []);
  for (const [name, type, value] of [['Caption', 'string', ''], ['IsCaptionVisible', 'bool', true],
    ['IsContentVisible', 'bool', true], ['IsGlyphVisible', 'bool', true]]) addProperty(registry, X + 'DragUIOverride', name, type, value);
  addMethod(registry, X + 'DragUIOverride', 'Clear', []);
  for (const owner of [X + 'DragUI', X + 'DragUIOverride']) for (const parameters of [[X + 'Media.Imaging.BitmapImage'],
    [X + 'Media.Imaging.BitmapImage', 'Windows.Foundation.Point']]) addMethod(registry, owner, 'SetContentFromBitmapImage', parameters);
  registerStorageContracts(registry);
}

function registerStorageContracts(registry) {
  addType(registry, storageItemType, { kind: 'interface' }, []);
  for (const name of ['Name', 'Path']) addProperty(registry, storageItemType, name, 'string', '', true);
  addType(registry, 'Windows.Storage.StorageFile', { kind: 'object', interfaces: [storageItemType] }, []);
  for (const name of ['Name', 'Path', 'FileType', 'ContentType']) addProperty(registry, 'Windows.Storage.StorageFile', name, 'string', '', true);
  addType(registry, storageEnumeratorType, { kind: 'interface' }, []);
  addProperty(registry, storageEnumeratorType, 'Current', storageItemType, null, true);
  addMethod(registry, storageEnumeratorType, 'MoveNext', [], 'bool');
  addMethod(registry, storageEnumeratorType, 'Reset', []);
  addMethod(registry, storageEnumeratorType, 'Dispose', []);
  addType(registry, storageEnumerableType, { kind: 'interface' }, []);
  addMethod(registry, storageEnumerableType, 'GetEnumerator', [], storageEnumeratorType);
  addType(registry, storageListType, { kind: 'interface', interfaces: [storageEnumerableType], elementType: storageItemType }, []);
  addProperty(registry, storageListType, 'Count', 'int', 0, true);
  addMethod(registry, storageListType, 'get_Item', ['int'], storageItemType, { kind: 'get', property: 'Item' });
  addMethod(registry, storageListType, 'GetEnumerator', [], storageEnumeratorType);
  const task = registry.TASK + '`1<' + storageListType + '>';
  addType(registry, task, { kind: 'task', base: registry.TASK }, []);
  addMethod(registry, D + 'DataPackageView', 'GetStorageItemsAsync', [], task);
  addType(registry, D + 'StandardDataFormats', { kind: 'static' }, []);
  if (!registry.types.get(D + 'StandardDataFormats').properties.StorageItems) {
    registry.prop(D + 'StandardDataFormats', 'StorageItems', 'string', 'StorageItems', true, true);
  }
}
