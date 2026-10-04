import {ControlTemplate} from '../templates/template-factory.js';
import {ValueSource} from '../property/property-store.js';
import {ResourceFault} from '../resources/errors.js';
import {resourceTargetType} from './resource-target-type.js';

/** Compile the released VisualTree profile once into a typed, immutable factory recipe. */
export function createLegacyTemplateFactory(context, template) {
  const prototype = context.read(template, 'VisualTree');
  if (!prototype) throw new ResourceFault('SFTPL016', 'ControlTemplate has neither a factory nor a VisualTree definition.');
  const targetType = resourceTargetType(context, template);
  const seen = new Set();
  const adapter = context.templateHostAdapter;
  const capture = (reference, depth) => {
    const id = context.id(reference);
    if (seen.has(id) || seen.size >= 100000 || depth > 512) throw new ResourceFault('SFTPL017', 'Invalid or oversized template definition.');
    seen.add(id);
    const type = context.typeOf(reference);
    const properties = [];
    const collections = [];
    for (const [name, descriptor] of Object.entries(context.propertiesFor(type))) {
      if (descriptor.isStatic) continue;
      const value = context.read(reference, name);
      if (value === null || value === undefined) continue;
      if (context.frameworkRegistry.types.get(descriptor.type)?.kind === 'collection') {
        const items = context.items(value).map(item => adapter.isVisual(item) ? capture(item, depth + 1) : {value: item});
        if (items.length) collections.push({name, items});
      } else if (!descriptor.readOnly && !['Style', 'Template'].includes(name)) {
        properties.push({name, type: descriptor.type, value: adapter.isVisual(value) ? capture(value, depth + 1) : {value}});
      }
    }
    const bindings = context.templateBindings?.(reference) ?? [];
    return Object.freeze({type, properties: Object.freeze(properties), collections: Object.freeze(collections), bindings});
  };
  const recipe = capture(prototype, 0);
  const instantiate = (definition, templateContext) => {
    if (Object.hasOwn(definition, 'value')) return definition.value;
    const instance = context.make(definition.type);
    for (const property of definition.properties) {
      const value = instantiate(property.value, templateContext);
      const token = context.propertyRegistry.lookup(definition.type, property.name);
      if (token) context.storeFor(instance).setSource(token, ValueSource.TemplatedParent,
        context.properties.toNative(value, property.type));
      else context.write(instance, property.name, value);
    }
    for (const collection of definition.collections) {
      const list = context.read(instance, collection.name);
      for (const child of collection.items) context.addItem(list, instantiate(child, templateContext));
    }
    for (const [target, source] of definition.bindings) {
      templateContext.bind(instance, context.propertyRegistry.lookup(definition.type, target),
        context.propertyRegistry.lookup(context.typeOf(templateContext.owner), source));
    }
    return instance;
  };
  const factory = new ControlTemplate(templateContext => instantiate(recipe, templateContext), {targetType});
  factory.retainedValues = function* () {
    const queue = [recipe];
    while (queue.length) {
      const node = queue.pop();
      if (Object.hasOwn(node, 'value')) yield node.value;
      else {
        for (const property of node.properties) queue.push(property.value);
        for (const collection of node.collections) queue.push(...collection.items);
      }
    }
  };
  return factory;
}
