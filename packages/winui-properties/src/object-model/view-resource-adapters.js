import {CollectionViewSource, GroupStyle} from '../items/collection-view.js';
import {ItemsSourceController} from '../items/items-source.js';
import {styleModel, resourceScopeModel} from './resource-adapter-models.js';
import {selectorModel} from './selector-model.js';
import {registerItemEvents} from './item-event-adapters.js';
import {itemGeneratorModel} from './item-generator-model.js';
export {itemGeneratorModel} from './item-generator-model.js';

const x = 'Microsoft.UI.Xaml.';
const controls = x + 'Controls.';
const data = x + 'Data.';

function sourceItems(context, reference) {
  if (reference === null) return [];
  const model = context.unwrapModel(reference);
  if (model?.[Symbol.iterator]) return model;
  return context.bindingServices?.collection?.(reference) ?? context.items(reference);
}

function sourceModel(context, reference) {
  const model = context.unwrapModel(reference);
  if (model instanceof CollectionViewSource) return model;
  return context.state(reference, 'collectionViewSource', () => createViewSource(context));
}

const createViewSource = context => new CollectionViewSource({read: (value, name) => {
  const result = context.bindingServices?.read ? context.bindingServices.read(value, {kind: 'property', name}) : context.read(value, name);
  const model = context.unwrapModel(result);
  return model?.[Symbol.iterator] ? model : context.bindingServices?.collection?.(result) ?? model;
}});

export function registerViewResourceAdapters(registry) {
  registry.register({owner: data + 'CollectionViewSource', kind: 'constructor', name: '.ctor'}, ({context}) =>
    context.wrapModel(createViewSource(context), data + 'CollectionViewSource'));
  for (const name of ['Source', 'IsSourceGrouped', 'ItemsPath']) {
    registry.register({owner: data + 'CollectionViewSource', kind: 'set', name: 'set_' + name}, ({context, receiver, args}) => {
      const model = sourceModel(context, receiver);
      if (name === 'Source') {
        const source = sourceItems(context, args[0]);
        const previous = model.view.sourceReference;
        model.view.sourceReference = args[0];
        try { model.setSource(source); }
        catch (error) {
          if (model.source !== source) model.view.sourceReference = previous;
          throw error;
        }
      } else {
        const field = name[0].toLowerCase() + name.slice(1), previous = model[field];
        model[field] = context.native(args[0]);
        try { model.refresh(); } catch (error) { model[field] = previous; throw error; }
      }
      context.write(receiver, name, args[0]);
      return null;
    });
  }
  registry.register({owner: data + 'CollectionViewSource', kind: 'get', name: 'get_View'}, ({context, receiver}) =>
    context.wrapModel(sourceModel(context, receiver).view, data + 'ICollectionView'));
  for (const name of ['CurrentItem', 'CurrentPosition', 'IsCurrentBeforeFirst', 'IsCurrentAfterLast']) {
    registry.register({owner: data + 'ICollectionView', kind: 'get', name: 'get_' + name}, ({context, receiver, descriptor}) =>
      context.managed(context.unwrapModel(receiver)[name[0].toLowerCase() + name.slice(1)], descriptor.result));
  }
  for (const name of ['MoveCurrentTo', 'MoveCurrentToPosition', 'MoveCurrentToFirst', 'MoveCurrentToLast', 'MoveCurrentToNext', 'MoveCurrentToPrevious']) {
    registry.register({owner: data + 'ICollectionView', name}, ({context, receiver, args}) => {
      const values = name === 'MoveCurrentTo' ? args : args.map(value => context.native(value));
      return context.unwrapModel(receiver)[name[0].toLowerCase() + name.slice(1)](...values);
    });
  }
  registry.register({owner: controls + 'GroupStyle', kind: 'constructor', name: '.ctor'}, ({context}) =>
    context.wrapModel(new GroupStyle(), controls + 'GroupStyle'));
  for (const name of ['HeaderTemplate', 'HeaderTemplateSelector', 'ContainerStyle', 'HeaderContainerStyle', 'HidesIfEmpty']) {
    const field = name[0].toLowerCase() + name.slice(1);
    registry.register({owner: controls + 'GroupStyle', kind: 'get', name: 'get_' + name}, ({context, receiver, descriptor}) => {
      const value = context.unwrapModel(receiver)[field];
      return value?.snapshot ? context.wrapModel(value, descriptor.result) : context.managed(value, descriptor.result);
    });
    registry.register({owner: controls + 'GroupStyle', kind: 'set', name: 'set_' + name}, ({context, receiver, args}) => {
      const model = context.unwrapModel(receiver);
      model[field] = name === 'ContainerStyle' || name === 'HeaderContainerStyle' ? styleModel(context, args[0]) :
        name === 'HeaderTemplateSelector' ? selectorModel(context, args[0]) : context.unwrapModel(args[0]);
      model.notifyDefinitionChanged();
      return null;
    });
  }
  for (const name of ['ItemsControl', 'ListViewBase', 'ListView', 'ComboBox', 'GridView', 'ListBox', 'ItemsView', 'FlipView']) {
    registerItemsProperties(registry, controls + name);
  }
  registerItemEvents(registry);
  for (const owner of [controls + 'ItemsControl', controls + 'ItemContainerGenerator']) {
    for (const name of ['ContainerFromItem', 'ContainerFromIndex', 'ItemFromContainer', 'IndexFromContainer']) {
      registry.register({owner, name}, ({context, receiver, args}) => {
        const model = itemGeneratorModel(context, receiver);
        const value = name === 'ContainerFromIndex' ? Number(context.native(args[0])) : args[0];
        return model[name[0].toLowerCase() + name.slice(1)](value);
      });
    }
  }
  registry.register({owner: controls + 'ItemsControl', kind: 'get', name: 'get_ItemContainerGenerator'}, ({context, receiver}) =>
    context.wrapModel(itemGeneratorModel(context, receiver), controls + 'ItemContainerGenerator'));
}

function registerItemsProperties(registry, owner) {
  registry.register({owner, kind: 'set', name: 'set_ItemsPanel'}, ({context, receiver, args}) => {
    context.write(receiver, 'ItemsPanel', args[0]);
    context.itemsChanged?.(receiver);
    return null;
  });
  registry.register({owner, kind: 'set', name: 'set_ItemsSource'}, ({context, receiver, args}) => {
    const generator = itemGeneratorModel(context, receiver);
    const controller = context.state(receiver, 'itemsSource', () => new ItemsSourceController(generator,
      {changed: value => context.itemsChanged?.(receiver, value)}));
    controller.notifyChanged = value => context.itemsChanged?.(receiver, value);
    const source = args[0] === null ? null : sourceItems(context, args[0]);
    const previous = generator.sourceReference, revision = generator.revision;
    generator.sourceReference = args[0] ?? context.read(receiver, 'Items');
    try {
      controller.setItemsSource(source, {committed: () => context.write(receiver, 'ItemsSource', args[0])});
    } catch (error) {
      if (generator.revision === revision) generator.sourceReference = previous;
      throw error;
    }
    return null;
  });
  for (const [name, field, unwrap] of [['ItemTemplate', 'template', 'model'],
    ['ItemTemplateSelector', 'templateSelector', 'selector'], ['ItemContainerStyle', 'containerStyle', 'style'],
    ['ItemContainerStyleSelector', 'styleSelector', 'styleSelector'], ['DisplayMemberPath', 'displayMemberPath', 'text']]) {
    registry.register({owner, kind: 'set', name: 'set_' + name}, ({context, receiver, args}) => {
      const generator = itemGeneratorModel(context, receiver);
      generator[field] = args[0] === null ? null : unwrap === 'style' ? styleModel(context, args[0]) :
        unwrap === 'selector' || unwrap === 'styleSelector' ? selectorModel(context, args[0], unwrap === 'styleSelector' ? 'style' : 'template')
          : unwrap === 'text' ? context.native(args[0]) : context.unwrapModel(args[0]);
      const realized = [...generator.byIndex.keys()];
      for (const index of realized) generator.recycle(index);
      for (const index of realized) generator.realize(index);
      context.write(receiver, name, args[0]);
      context.itemsChanged?.(receiver, generator);
      return null;
    });
  }
}
