import {createFrameworkXamlSchema} from '../xaml/framework-schema.js';
import {XamlObjectWriter} from '../xaml/object-writer.js';
import {XamlWriter} from '../xaml/xaml-writer.js';
import {resourceScopeModel} from './resource-adapter-models.js';
import {visualStateGroupCollection} from './visual-state-resource-adapters.js';
import {XamlParseException} from '../xaml/diagnostics.js';
import {withUIConstruction} from './construction-roots.js';
import {materializePropertyLiteral} from '../binding/type-converters.js';

function materializeLiteral(context, type, value) {
  if (context.materializeXamlValue) return context.materializeXamlValue(type, value);
  const typeDefinition = name => context.frameworkRegistry.types.get(name);
  const converted = materializePropertyLiteral(type, value, {typeDefinition});
  if (typeDefinition(type)?.kind === 'value' || !context.materializeResource) {
    return context.managed(converted, converted?.valueType ?? type);
  }
  return context.materializeResource(converted, type);
}

/** Build the loader with explicit host capabilities. File, network, reflection and script activation have no path here. */
export function createContextXamlLoader(context) {
  const schema = context.xamlSchema ?? createFrameworkXamlSchema({registry: context.frameworkRegistry,
    create: type => context.make(type),
    set: (receiver, name, value, type, options) => {
      if (options?.attached) {
        const token = context.propertyRegistry.lookup(options.owner, name);
        context.storeFor(receiver).setValue(token, context.properties.toNative(context.managed(value, type), type));
      } else context.setProperty ? context.setProperty(receiver, name, value, type) : context.write(receiver, name, context.managed(value, type));
    },
    get: (receiver, name) => context.read(receiver, name),
    add: (collection, value) => context.addItem(collection, context.managed(value)),
    insert: (collection, index, value) => context.insertItem(collection, index, context.managed(value)),
    remove: (collection, index) => context.removeItem(collection, index),
    propertyFor: (owner, name) => context.propertyRegistry.lookup(owner, name),
    parseGeometry: context.parseGeometry,
    visualStateGroupsFor: receiver => visualStateGroupCollection(context, receiver)
  });
  const materialize = (type, value) => materializeLiteral(context, type, value);
  const writer = new XamlObjectWriter(schema, {
    withConstruction: (action, roots) => withUIConstruction(context, action, roots),
    materialize,
    materializeType: descriptor => context.typeValue(descriptor.name),
    materializeResource: context.materializeResource,
    storeFor: receiver => context.storeFor(receiver),
    resourceScopeFor: receiver => resourceScopeModel(context, receiver),
    dispose: value => context.templateHostAdapter?.dispose?.(value),
    bind: context.bindXaml,
    compileBinding: context.compileBinding,
    deferElement: context.deferXamlElement,
    localize: context.services.stringResourceLoader?.bindUid ? (uid, write, owner) =>
      context.services.stringResourceLoader.bindUid(uid, write, {retainedValues: function* () { yield owner; }}) : null,
    setNameScope: (receiver, namescope) => context.write(receiver, '$nameScope', context.wrapModel(namescope, 'Microsoft.UI.Xaml.NameScope')),
    typeToken: type => type.name,
    propertyFor: (owner, name) => context.propertyRegistry.lookup(owner, name)
  });
  const serializer = new XamlWriter(schema, {typeOf: receiver => context.typeOf(receiver),
    unwrap: value => context.unwrapModel(value),
    items: value => {
      const model = context.unwrapModel(value);
      return model?.[Symbol.iterator] ? Array.from(model) : context.items(value);
    },
    valueOf: (value, type) => {
      if (context.serializeXamlValue) return context.serializeXamlValue(value, type);
      if (type === 'System.Type' && value) return {kind: 'TypeReference', name: context.typeName(value)};
      if (['value', 'enum'].includes(context.frameworkRegistry.types.get(type)?.kind) || ['string', 'bool', 'int', 'double'].includes(type)) {
        return context.properties.toNative(value, type);
      }
      return value;
    }});
  return {writer, schema, serializer, reconstructible: true};
}

export function registerXamlResourceAdapters(registry) {
  const markup = 'Microsoft.UI.Xaml.Markup.XamlReader';
  for (const name of ['LineNumber', 'LinePosition']) {
    const field = name[0].toLowerCase() + name.slice(1);
    registry.register({owner: 'Microsoft.UI.Xaml.Markup.XamlParseException', kind: 'get', name: 'get_' + name},
      ({context, receiver}) => context.xamlExceptionInfo?.(receiver)?.[field] ?? receiver[field] ?? 0);
  }
  for (const name of ['Load', 'LoadWithInitialTemplateValidation']) {
    registry.register({owner: markup, name}, ({context, args}) => withUIConstruction(context, () => {
      const loader = context.state(null, 'xamlLoader', () => createContextXamlLoader(context));
      let result;
      try {
        result = loader.writer.load(context.native(args[0]), {resources: context.applicationResources,
          initialTemplateValidation: name === 'LoadWithInitialTemplateValidation'});
      } catch (error) {
        if (error instanceof XamlParseException && context.createXamlException) throw context.createXamlException(error);
        throw error;
      }
      const type = loader.schema.metadata.get(result.root)?.type?.name;
      const root = result.root?.snapshot && result.root?.restore
        ? context.wrapModel(result.root, type) : context.managed(result.root, type);
      context.state(root, 'xamlLifetime', () => result.lifetime);
      return root;
    }, args));
  }
  registry.register({owner: 'SharpForge.Xaml.XamlWriter', name: 'Save'}, ({context, args}) => {
    const loader = context.state(null, 'xamlLoader', () => createContextXamlLoader(context));
    return context.managed(loader.serializer.save(context.unwrapModel(args[0])), 'string');
  });
}
