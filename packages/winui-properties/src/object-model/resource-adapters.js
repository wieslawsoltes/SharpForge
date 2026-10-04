import {ResourceDictionary} from '../resources/resource-dictionary.js';
import {NameScope} from '../templates/name-scope.js';
import {ResourceModelCollection, dictionaryModel, nameScopeModel, resourceScopeModel, nativeResourceKey} from './resource-adapter-models.js';
import {registerStyleResourceAdapters} from './style-resource-adapters.js';
import {registerTemplateResourceAdapters} from './template-resource-adapters.js';
import {registerXamlResourceAdapters} from './xaml-resource-adapters.js';
import {registerViewResourceAdapters} from './view-resource-adapters.js';
import {registerVisualStateResourceAdapters} from './visual-state-resource-adapters.js';
import {registerResourceCollectionAdapters} from './resource-collection-adapters.js';

const x = 'Microsoft.UI.Xaml.';

/** Register framework wrappers through the shared invocation seam; no central runtime switches are added. */
export function registerResourceAdapters(registry) {
  registry.register({owner: x + 'ResourceDictionary', kind: 'constructor', name: '.ctor'}, ({context}) =>
    context.wrapModel(new ResourceDictionary(), x + 'ResourceDictionary'));
  const operations = {
    Add: (dictionary, args, context) => dictionary.add(nativeResourceKey(context, args[0]), args[1]),
    set_Item: (dictionary, args, context) => dictionary.set(nativeResourceKey(context, args[0]), args[1]),
    get_Item: (dictionary, args, context) => dictionary.get(nativeResourceKey(context, args[0])),
    Remove: (dictionary, args, context) => dictionary.remove(nativeResourceKey(context, args[0])),
    ContainsKey: (dictionary, args, context) => dictionary.containsKey(nativeResourceKey(context, args[0])),
    Clear: dictionary => dictionary.clear(),
    TryGetValue: (dictionary, args, context) => {
      const result = dictionary.tryGetValue(nativeResourceKey(context, args[0]));
      if (!context.writeReference) throw new Error('The current execution target does not support ResourceDictionary.TryGetValue out arguments.');
      context.writeReference(args[1], result.found ? result.value : null);
      return result.found;
    }
  };
  for (const [name, invoke] of Object.entries(operations)) {
    registry.register({owner: x + 'ResourceDictionary', name}, ({context, receiver, args, descriptor}) => {
      const value = invoke(dictionaryModel(context, receiver), args, context);
      return context.managed(value, descriptor.result);
    });
  }
  registry.register({owner: x + 'ResourceDictionary', kind: 'get', name: 'get_Count'}, ({context, receiver}) =>
    dictionaryModel(context, receiver).count);
  registry.register({owner: x + 'ResourceDictionary', kind: 'get', name: 'get_MergedDictionaries'}, ({context, receiver}) => {
    const dictionary = dictionaryModel(context, receiver);
    const collection = context.state(receiver, 'mergedView', () => new ResourceModelCollection({owner: receiver,
      read: () => dictionary.merged, write: next => dictionary.setMerged(next), unwrap: value => dictionaryModel(context, value)}));
    return context.wrapModel(collection, x + 'ResourceDictionaryCollection');
  });
  registry.register({owner: x + 'ResourceDictionary', kind: 'get', name: 'get_ThemeDictionaries'}, ({context, receiver}) => {
    const dictionary = dictionaryModel(context, receiver);
    const view = context.state(receiver, 'themeView', () => ({dictionary, reconstructible: true,
      retainedValues: function* () { yield receiver; yield* dictionary.retainedValues(); }}));
    return context.wrapModel(view, x + 'ThemeResourceDictionary');
  });
  registerDictionaryViews(registry);
  registerScopeProperties(registry);
  registerNameScopes(registry);
  registerStyleResourceAdapters(registry);
  registerTemplateResourceAdapters(registry);
  registerViewResourceAdapters(registry);
  registerVisualStateResourceAdapters(registry);
  registerXamlResourceAdapters(registry);
}

function registerDictionaryViews(registry) {
  registerResourceCollectionAdapters(registry, x + 'ResourceDictionaryCollection', x + 'ResourceDictionary');
  for (const name of ['Add', 'set_Item', 'get_Item', 'Remove', 'ContainsKey']) {
    registry.register({owner: x + 'ThemeResourceDictionary', name}, ({context, receiver, args}) => {
      const dictionary = context.unwrapModel(receiver).dictionary;
      const key = context.native(args[0]);
      if (name === 'get_Item') return context.wrapModel(dictionary.themes.get(key) ?? null, x + 'ResourceDictionary');
      if (name === 'ContainsKey') return dictionary.themes.has(key);
      if (name === 'Remove') { const exists = dictionary.themes.has(key); dictionary.removeTheme(key); return exists; }
      if (name === 'Add' && dictionary.themes.has(key)) throw new TypeError('Duplicate theme dictionary key.');
      dictionary.setTheme(key, dictionaryModel(context, args[1]));
      return null;
    });
  }
}

function registerScopeProperties(registry) {
  for (const owner of [x + 'FrameworkElement', x + 'Application']) {
    registry.register({owner, kind: 'get', name: 'get_Resources'}, ({context, receiver}) =>
      context.wrapModel(resourceScopeModel(context, receiver).resources, x + 'ResourceDictionary'));
    registry.register({owner, kind: 'set', name: 'set_Resources'}, ({context, receiver, args}) => {
      resourceScopeModel(context, receiver).setResources(dictionaryModel(context, args[0]));
      context.write(receiver, 'Resources', args[0]);
      return null;
    });
    registry.register({owner, kind: 'set', name: 'set_RequestedTheme'}, ({context, receiver, args}) => {
      const value = Number(context.native(args[0]));
      const theme = (owner.endsWith('Application') ? ['Light', 'Dark'] : ['Default', 'Light', 'Dark'])[value];
      resourceScopeModel(context, receiver).setTheme(theme);
      context.write(receiver, 'RequestedTheme', args[0]);
      return null;
    });
  }
  registry.register({owner: x + 'FrameworkElement', kind: 'get', name: 'get_ActualTheme'}, ({context, receiver}) =>
    resourceScopeModel(context, receiver).actualTheme === 'Dark' ? 2 : 1);
}

function registerNameScopes(registry) {
  registry.register({owner: x + 'NameScope', kind: 'constructor', name: '.ctor'}, ({context}) =>
    context.wrapModel(new NameScope(), x + 'NameScope'));
  for (const name of ['RegisterName', 'UnregisterName', 'FindName']) {
    registry.register({owner: x + 'NameScope', name}, ({context, receiver, args}) => {
      const scope = nameScopeModel(context, receiver);
      const key = context.native(args[0]);
      if (name === 'RegisterName') { scope.registerName(key, args[1]); return null; }
      if (name === 'UnregisterName') { scope.unregisterName(key); return null; }
      return scope.findName(key);
    });
  }
  registry.register({owner: x + 'NameScope', name: 'GetNameScope'}, ({context, args}) =>
    context.read(args[0], '$nameScope'));
  registry.register({owner: x + 'NameScope', name: 'SetNameScope'}, ({context, args}) => {
    context.write(args[0], '$nameScope', args[1]);
    return null;
  });
}
