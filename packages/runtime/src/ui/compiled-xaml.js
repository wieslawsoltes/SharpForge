import {CompiledBindings, CompiledBindingDefinition, CompiledBindingGroup, CompiledBindingLifetime,
  CompiledBindingCompileError, compileBindingDescriptor, compileBindingExpression, validateCompiledBindingDescriptor,
  resolveMarkupExtension, ResourceReference} from '@sharpforge/winui-properties';
import {ManagedCompiledSymbols} from './compiled-symbols.js';
import {managedBindingTypeName as canonicalType} from './member-access.js';

const allowed = new Set(['Path', 'Mode', 'Converter', 'ConverterParameter', 'ConverterLanguage', 'BindBack']);
const expectedConverter = ['object', 'System.Type', 'object', 'string'];
const contextual = name => ({kind: 'context', name});

function markupOptions(node) {
  if (node?.kind !== 'MarkupExtension' || !Array.isArray(node.arguments) || node.arguments.length > 1
    || Object.keys(node.properties).some(name => !allowed.has(name))
    || node.arguments.length && Object.hasOwn(node.properties, 'Path')) {
    throw new CompiledBindingCompileError('SFXB002', 'Invalid x:Bind argument list');
  }
  const options = {expression: node.arguments[0] ?? node.properties.Path ?? '', mode: node.properties.Mode ?? 'OneTime',
    bindBack: node.properties.BindBack};
  if (typeof options.expression !== 'string' || !['OneTime', 'OneWay', 'TwoWay'].includes(options.mode)
    || options.bindBack !== undefined && typeof options.bindBack !== 'string') {
    throw new CompiledBindingCompileError('SFXB002', 'x:Bind requires a typed expression and a supported mode');
  }
  return options;
}

function resource(value, xamlContext) {
  const resolved = resolveMarkupExtension(value, xamlContext);
  if (!(resolved instanceof ResourceReference)) return resolved;
  if (resolved.dynamic) throw new CompiledBindingCompileError('SFXB004', 'Compiled converters require a stable resource reference');
  return xamlContext.resources.find(resolved.key, {maxEntries: xamlContext.resourceLimits});
}

/** XAML names are compiled once against real assembly metadata; runtime updates execute the resulting token descriptor. */
export function createManagedCompiledBindingCompiler(context) {
  return (node, extensionContext) => {
    const options = markupOptions(node);
    return new CompiledBindingDefinition(specification => {
      const xamlContext = {...extensionContext, ...specification.context};
      const lifetime = new CompiledBindingLifetime(() => initialize(context, {...specification, context: xamlContext}, node, options));
      if (!Array.isArray(xamlContext.afterBuild) || xamlContext.afterBuild.length >= 100000) {
        throw new CompiledBindingCompileError('SFXB003', 'x:Bind requires the object writer initialization phase');
      }
      xamlContext.afterBuild.push(() => lifetime.attach());
      return lifetime;
    }, node);
  };
}

function initialize(context, specification, node, options) {
  const xamlContext = specification.context;
  const root = xamlContext.root;
  const target = specification.target;
  if (!root || !target) throw new CompiledBindingCompileError('SFXB003', 'Compiled XAML requires an explicit root and target');
  return context.platform.heap.withRoots([root, target], () => {
    const symbols = context.state(null, 'compiledBindingSymbols', () =>
      new ManagedCompiledSymbols(context, context.bindingServices.members)).scope(xamlContext);
    const rootType = canonicalType(context.typeOf(root));
    const targetType = canonicalType(context.typeOf(target));
    const kind = specification.property.kind === 'load' ? 'load'
      : specification.property.event || specification.property.kind === 'event' ? 'event' : 'property';
    const member = kind === 'load' ? {type: 'bool'} : symbols.target(targetType, specification.property.name, kind);
    const sourceType = kind === 'event' ? 'object' : compileBindingExpression(options.expression, {symbols, rootType}).type;
    const targetDescriptor = kind === 'load' ? {id: context.id(target), name: specification.property.name}
      : {id: context.id(target), token: member.token};
    let descriptor = compileBindingDescriptor({...options, symbols, rootType, target: targetDescriptor, kind,
      targetValueType: member.type, eventTypes: specification.property.eventTypes,
      sourceTypeToken: symbols.type(rootType)?.token, targetTypeToken: symbols.type(targetType)?.token,
      phase: xamlContext.phase ?? 0});
    const conversion = converters(context, symbols, node, xamlContext, sourceType, member.type, options.mode);
    descriptor = validateCompiledBindingDescriptor({...descriptor, ...conversion.descriptor});
    const services = {...context.bindingServices.compiled,
      stateChanged: () => { if (context.isAlive(target)) context.syncOwner(target); }};
    if (xamlContext.deferredScope) services.setLoad = (receiver, name, value) => xamlContext.deferredScope.setLoad(name, value);
    const controller = new CompiledBindings({descriptors: [descriptor], source: () => root, target: () => target,
      services, contextValues: {sourceRoot: root, ...conversion.contextValues},
      phases: descriptor.phase ? context.getBindingPhases(xamlContext.templateContext?.owner ?? root) : null});
    const targetGroup = context.state(target, 'compiledBindings', () => new CompiledBindingGroup());
    return {controller, groups: [targetGroup, context.getCompiledBindings(root)],
      run: action => context.platform.heap.withRoots([root, target, ...controller.retainedValues()], () => {
        action();
        context.syncOwner(target);
      })};
  });
}

function converterMethod(context, symbols, converter, name) {
  const members = context.bindingServices.members;
  const method = members.method(converter, name, 4, {interfaceType: 'Microsoft.UI.Xaml.Data.IValueConverter'})
    ?? symbols.method(context.typeOf(converter), name, expectedConverter);
  if (!method?.token || method.parameters.length !== 4
    || method.parameters.some((type, index) => canonicalType(type) !== expectedConverter[index])
    || canonicalType(method.returnType) !== 'object') {
    throw new CompiledBindingCompileError('SFXB005', 'Compiled IValueConverter requires the declared four-argument metadata method');
  }
  return {kind: 'call', token: method.token, receiver: contextual('converter'),
    arguments: [contextual('value'), contextual(name === 'Convert' ? 'targetType' : 'sourceType'), contextual('parameter'), contextual('language')]};
}

function converters(context, symbols, node, xamlContext, sourceType, targetType, mode) {
  const values = node.properties;
  const descriptor = {};
  if (values.Converter === undefined) {
    if (values.ConverterParameter !== undefined || values.ConverterLanguage !== undefined) {
      throw new CompiledBindingCompileError('SFXB004', 'Converter parameters require a compiled converter');
    }
    return {descriptor, contextValues: {}};
  }
  const converter = resource(values.Converter, xamlContext);
  if (!converter) throw new CompiledBindingCompileError('SFXB004', 'The compiled converter resource is unavailable');
  context.platform.heap.pins.push(converter);
  const parameter = values.ConverterParameter === undefined ? null : resource(values.ConverterParameter, xamlContext);
  context.platform.heap.pins.push(parameter);
  const language = values.ConverterLanguage === undefined ? '' : resource(values.ConverterLanguage, xamlContext);
  if (typeof language !== 'string') throw new CompiledBindingCompileError('SFXB004', 'ConverterLanguage must be a string');
  const targetTypeValue = context.typeValue(targetType ?? 'object');
  context.platform.heap.pins.push(targetTypeValue);
  const sourceTypeValue = context.typeValue(sourceType === 'null' ? 'object' : sourceType);
  context.platform.heap.pins.push(sourceTypeValue);
  descriptor.converter = converterMethod(context, symbols, converter, 'Convert');
  if (mode === 'TwoWay') descriptor.convertBack = converterMethod(context, symbols, converter, 'ConvertBack');
  return {descriptor, contextValues: {converter, parameter, language, targetType: targetTypeValue, sourceType: sourceTypeValue}};
}
