import {ObservableCollectionModel} from './collection-model.js';
import {ObservableEventArguments, collectionChangedArguments} from './event-arguments.js';
import {registerVectorAdapters} from './vector-adapters.js';

const propertyArgs = 'System.ComponentModel.PropertyChangedEventArgs';
const collectionArgs = 'System.Collections.Specialized.NotifyCollectionChangedEventArgs';

function model(context, receiver) {
  const value = context.unwrapModel(receiver);
  if (!(value instanceof ObservableCollectionModel)) throw new TypeError('Observable collection model is unavailable');
  return value;
}

function eventArgument({context, receiver, descriptor}) {
  const value = context.unwrapModel(receiver).values[descriptor.property ?? descriptor.name.slice(4)];
  if (Array.isArray(value)) {
    if (!context.array) throw new TypeError('Observable event arrays require the host array service');
    return context.array(value, 'object');
  }
  return context.managed(value, descriptor.result);
}

/** Observable ABI members use one vector model for mutations, indexers and event deltas. */
export function registerObservableAdapters(registry) {
  registry.register({owner: propertyArgs, kind: 'constructor', name: '.ctor'}, ({context, args}) => {
    return context.wrapModel(new ObservableEventArguments({PropertyName: context.native(args[0])}), propertyArgs);
  });
  registry.register({owner: propertyArgs, kind: 'get', name: 'get_PropertyName'}, eventArgument);
  registry.register({owner: collectionArgs, kind: 'constructor', name: '.ctor'}, ({context, args}) => {
    const values = args.map((value, index) => index === 0 || index === args.length - 1
      ? context.native(value) : context.properties.toNative(value, 'object'));
    return context.wrapModel(collectionChangedArguments(values[0], values), collectionArgs);
  });
  for (const name of ['Action', 'NewItems', 'OldItems', 'NewStartingIndex', 'OldStartingIndex']) {
    registry.register({owner: collectionArgs, kind: 'get', name: 'get_' + name}, eventArgument);
  }
  for (const element of ['object', 'string', 'int', 'double', 'bool']) {
    registerCollection(registry, `System.Collections.ObjectModel.ObservableCollection\`1<${element}>`);
  }
  registerVectorAdapters(registry);
}

function registerCollection(registry, owner) {
  registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context}) => {
    const collection = new ObservableCollectionModel(context, {maxItems: context.services?.maxCollectionItems ?? 1000000});
    const receiver = context.wrapModel(collection, owner);
    collection.receiver = receiver;
    return receiver;
  });
  registry.register({owner, kind: 'get', name: 'get_Count'}, ({context, receiver}) => {
    return context.managed(model(context, receiver).Count, 'int');
  });
  for (const name of ['Add', 'Insert', 'Remove', 'RemoveAt', 'Move', 'Clear', 'Contains', 'IndexOf', 'get_Item', 'set_Item']) {
    registry.register({owner, name}, ({context, receiver, descriptor, args}) => {
      const collection = model(context, receiver);
      context.sceneJournal?.captureModel(collection);
      const values = args.map((value, index) => context.properties.toNative(value, descriptor.parameters[index]));
      const result = collection[name](...values);
      return descriptor.result === 'void' ? null : context.managed(result, descriptor.result);
    });
  }
  for (const name of ['PropertyChanged', 'CollectionChanged']) {
    registry.register({owner, kind: 'eventAdd', name: 'add_' + name}, ({context, receiver, args}) => model(context, receiver).addEvent(name, args[0]));
    registry.register({owner, kind: 'eventRemove', name: 'remove_' + name}, ({context, receiver, args}) => model(context, receiver).removeEvent(name, args[0]));
  }
}
