import {registerVectorContracts} from './property-vectors.js';

/** Standard managed observable contracts and closed generic collection bridge shapes. */
export function registerObservableContracts(registry) {
  const {define, ctor, prop, member, delegate, event, en, CONTROLS} = registry;
  const component = 'System.ComponentModel.';
  const specialized = 'System.Collections.Specialized.';
  define(component + 'PropertyChangedEventArgs', {kind: 'propertyChangedArgs'});
  ctor(component + 'PropertyChangedEventArgs', ['string']);
  prop(component + 'PropertyChangedEventArgs', 'PropertyName', 'string', null, true);
  delegate(component + 'PropertyChangedEventHandler', ['object', component + 'PropertyChangedEventArgs']);
  define(component + 'INotifyPropertyChanged', {kind: 'interface'});
  event(component + 'INotifyPropertyChanged', 'PropertyChanged', component + 'PropertyChangedEventHandler');
  en(specialized + 'NotifyCollectionChangedAction', {Add: 0, Remove: 1, Replace: 2, Move: 3, Reset: 4});
  define(specialized + 'NotifyCollectionChangedEventArgs', {kind: 'collectionChangedArgs'});
  const args = specialized + 'NotifyCollectionChangedEventArgs';
  const action = specialized + 'NotifyCollectionChangedAction';
  ctor(args, [action]);
  ctor(args, [action, 'object', 'int']);
  ctor(args, [action, 'object', 'int', 'int']);
  ctor(args, [action, 'object', 'object', 'int']);
  for (const [name, type, value] of [
    ['Action', action, 4], ['NewItems', 'object[]', null], ['OldItems', 'object[]', null],
    ['NewStartingIndex', 'int', -1], ['OldStartingIndex', 'int', -1]
  ]) prop(args, name, type, value, true);
  delegate(specialized + 'NotifyCollectionChangedEventHandler', ['object', args]);
  define(specialized + 'INotifyCollectionChanged', {kind: 'interface'});
  event(specialized + 'INotifyCollectionChanged', 'CollectionChanged', specialized + 'NotifyCollectionChangedEventHandler');
  for (const element of ['object', 'string', 'int', 'double', 'bool']) registerCollection(registry, element);
  const vector = 'Windows.Foundation.Collections.';
  en(vector + 'CollectionChange', {Reset: 0, ItemInserted: 1, ItemRemoved: 2, ItemChanged: 3});
  define(vector + 'VectorChangedEventArgs', {kind: 'vectorChangedArgs'});
  prop(vector + 'VectorChangedEventArgs', 'CollectionChange', vector + 'CollectionChange', 0, true);
  prop(vector + 'VectorChangedEventArgs', 'Index', 'uint', 0, true);
  delegate(vector + 'VectorChangedEventHandler', ['object', vector + 'VectorChangedEventArgs']);
  for (const name of ['ItemCollection', 'UIElementCollection']) {
    event(CONTROLS + name, 'VectorChanged', vector + 'VectorChangedEventHandler');
  }
  registerVectorContracts(registry);
}

function registerCollection({define, ctor, prop, member, event}, element) {
  const type = `System.Collections.ObjectModel.ObservableCollection\`1<${element}>`;
  define(type, {kind: 'collection', family: 'observableCollection', element, elementType: element, interfaces: [
    'System.ComponentModel.INotifyPropertyChanged', 'System.Collections.Specialized.INotifyCollectionChanged',
    `Windows.Foundation.Collections.IObservableVector\`1<${element}>`, `System.Collections.Generic.IList\`1<${element}>`
  ]});
  ctor(type);
  prop(type, 'Count', 'int', 0, true);
  for (const [name, parameters, result] of [
    ['Add', [element], 'void'], ['Insert', ['int', element], 'void'], ['Remove', [element], 'bool'],
    ['RemoveAt', ['int'], 'void'], ['Move', ['int', 'int'], 'void'], ['Clear', [], 'void'],
    ['Contains', [element], 'bool'], ['IndexOf', [element], 'int'], ['get_Item', ['int'], element],
    ['set_Item', ['int', element], 'void']
  ]) member(type, name, parameters, result);
  event(type, 'PropertyChanged', 'System.ComponentModel.PropertyChangedEventHandler');
  event(type, 'CollectionChanged', 'System.Collections.Specialized.NotifyCollectionChangedEventHandler');
}
