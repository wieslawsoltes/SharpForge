import {Style, Setter} from '../styles/style.js';
import {ResourceModelCollection, styleModel, setterModel, requireMutableStyle} from './resource-adapter-models.js';
import {registerResourceCollectionAdapters} from './resource-collection-adapters.js';

const x = 'Microsoft.UI.Xaml.';

/** Only the released string-constructor ABI retains mutable style-definition behavior. */
export function registerStyleResourceAdapters(registry) {
  registry.register({owner: x + 'Style', kind: 'constructor', name: '.ctor'}, ({context, args, descriptor}) => {
    const parameter = descriptor.parameters?.[0];
    const legacyMutable = ['string', 'System.String'].includes(parameter)
      || !descriptor.parameters && typeof args[0] === 'string';
    const model = new Style(args.length ? context.typeName(args[0]) : 'object', {legacyMutable});
    return context.wrapModel(model, x + 'Style');
  });
  registry.register({owner: x + 'Setter', kind: 'constructor', name: '.ctor'}, ({context, args}) => {
    const property = args[0] ? context.properties.resolve(args[0]) : undefined;
    const value = property ? context.properties.toNative(args[1], property.propertyType) : null;
    return context.wrapModel(new Setter(property, value), x + 'Setter');
  });
  for (const owner of [x + 'Style', x + 'Setter']) {
    registry.register({owner, kind: 'get', name: 'get_IsSealed'}, ({context, receiver}) =>
      (owner.endsWith('Setter') ? setterModel(context, receiver) : styleModel(context, receiver)).isSealed);
  }
  for (const name of ['TargetType', 'TargetTypeName', 'BasedOn']) {
    registry.register({owner: x + 'Style', kind: 'get', name: 'get_' + name}, ({context, receiver}) => {
      const model = styleModel(context, receiver);
      if (name === 'BasedOn') return model.basedOn ? context.wrapModel(model.basedOn, x + 'Style') : null;
      return name === 'TargetType' ? context.typeValue(model.targetType) : context.managed(model.targetType, 'string');
    });
    registry.register({owner: x + 'Style', kind: 'set', name: 'set_' + name}, ({context, receiver, args}) => mutateDefinition(context, () => {
      const model = styleModel(context, receiver);
      requireMutableStyle(model);
      if (name === 'BasedOn') model.basedOn = args[0] ? styleModel(context, args[0]) : null;
      else model.targetType = context.typeName(args[0]);
      context.write(receiver, name, args[0]);
      return null;
    }));
  }
  registry.register({owner: x + 'Style', kind: 'get', name: 'get_Setters'}, ({context, receiver}) => {
    const style = styleModel(context, receiver);
    const collection = context.state(receiver, 'styleSetters', () => new ResourceModelCollection({owner: receiver,
      read: () => style.setters,
      write: values => mutateDefinition(context, () => {
        const definition = styleModel(context, receiver);
        requireMutableStyle(definition);
        definition.setters = values;
      }),
      unwrap: value => setterModel(context, value)}));
    return context.wrapModel(collection, x + 'SetterBaseCollection');
  });
  registerResourceCollectionAdapters(registry, x + 'SetterBaseCollection', x + 'Setter');
  for (const name of ['Property', 'Value', 'Target']) registerSetterProperty(registry, name);
  registry.register({owner: x + 'TargetPropertyPath', kind: 'constructor', name: '.ctor'}, ({context, args}) =>
    context.allocate(x + 'TargetPropertyPath', {Path: args[0] ?? ''}));
}

function registerSetterProperty(registry, name) {
  registry.register({owner: x + 'Setter', kind: 'get', name: 'get_' + name}, ({context, receiver}) => {
    const model = setterModel(context, receiver);
    if (name === 'Property') return model.property ? context.properties.wrap(model.property) : null;
    if (name === 'Target') return model.target ? context.allocate(x + 'TargetPropertyPath', {Path: model.target}) : null;
    return context.properties.toManaged(model.value, model.property?.propertyType ?? 'object', {box: true});
  });
  registry.register({owner: x + 'Setter', kind: 'set', name: 'set_' + name}, ({context, receiver, args}) => mutateDefinition(context, () => {
    const model = setterModel(context, receiver);
    requireMutableStyle(model);
    if (name === 'Property') model.property = args[0] ? context.properties.resolve(args[0]) : undefined;
    else if (name === 'Target') model.target = args[0] ? context.native(context.read(args[0], 'Path')) : null;
    else model.value = context.properties.toNative(args[0], model.property?.propertyType ?? 'object');
    context.write(receiver, name, args[0]);
    return null;
  }));
}

function mutateDefinition(context, action) {
  return context.sceneTransaction ? context.sceneTransaction(action) : action();
}
