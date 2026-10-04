import {ResourceDictionary} from '../resources/resource-dictionary.js';
import {ResourceScope} from '../resources/resource-scope.js';
import {DeferredResource, ResourceReference} from '../resources/reference.js';
import {Style, Setter} from '../styles/style.js';
import {ControlTemplate, DataTemplate, ItemsPanelTemplate} from '../templates/template-factory.js';
import {XAML_NAMESPACE, PRESENTATION_NAMESPACE, XML_NAMESPACE, XMLNS_NAMESPACE, COMPATIBILITY_NAMESPACE} from './xml-reader.js';
import {parseMarkupExtension, resolveMarkupExtension} from './markup-extensions.js';
import {convertXamlValue} from './type-converters.js';
import {xamlFault} from './diagnostics.js';

const elements = node => node.children.filter(child => child.kind === 'startElement');
const attribute = (node, name) => node.attributes.find(value => value.localName === name && !value.namespace)?.value;
const directive = (node, name) => node.attributes.find(value => value.localName === name && value.namespace === XAML_NAMESPACE)?.value;
const resourceType = (node, context) => context.schema.resolve(node.namespace, node.localName)?.name;
const resourceProperty = (node, owner, property, context) => node.localName === owner + '.' + property &&
  context.schema.resolve(node.namespace, owner)?.name === 'Microsoft.UI.Xaml.' + owner;

function typeToken(text, node, context) {
  const type = context.schema.resolveQualifiedName(text, node.namespaces, node.span);
  return context.writer.services.typeToken?.(type) ?? type.name;
}

function literal(text, type, node, context) {
  const expression = parseMarkupExtension(text, {span: node.span});
  if (expression?.kind === 'MarkupExtension') return resolveMarkupExtension(expression, {
    ...context, span: node.span, namespaces: node.namespaces,
    rememberBinding: (binding, metadata) => context.schema.remember(binding, metadata),
    resolveType: name => typeToken(name, node, context)
  });
  const value = convertXamlValue(expression, type, {span: node.span, type: name => context.schema.type(name),
    resolveType: name => typeToken(name, node, context), converters: context.schema.converters,
    parseGeometry: context.schema.parseGeometry});
  return context.writer.services.materialize?.(type, value) ?? value;
}

function validateAttributes(node, allowed) {
  for (const attribute of node.attributes) {
    if ([XAML_NAMESPACE, XML_NAMESPACE, XMLNS_NAMESPACE, COMPATIBILITY_NAMESPACE].includes(attribute.namespace)) continue;
    if (node.ignorable.has(attribute.namespace)) continue;
    if (attribute.namespace || !allowed.includes(attribute.localName)) {
      throw xamlFault('SFXAML054', `Unsupported resource property '${attribute.qualifiedName}'.`, attribute);
    }
  }
}

/** Resources retain their lexical lookup boundary, so a later StaticResource cannot become a valid forward reference. */
export function buildResourceDictionary(node, context) {
  if (resourceType(node, context) !== 'Microsoft.UI.Xaml.ResourceDictionary') {
    throw xamlFault('SFXAML076', 'Dictionary collections require ResourceDictionary elements.', node);
  }
  validateAttributes(node, []);
  const dictionary = new ResourceDictionary();
  const scope = new ResourceScope({resources: dictionary, parent: context.resources});
  context.lifetime.add(scope);
  context.lifetime.add(dictionary);
  context.schema.remember(dictionary, {type: context.descriptor, node, resourceScope: scope});
  for (const child of elements(node)) {
    if (resourceProperty(child, 'ResourceDictionary', 'MergedDictionaries', context)) {
      for (const merged of elements(child)) dictionary.addMerged(buildResourceDictionary(merged, {...context, resources: scope}));
      continue;
    }
    if (resourceProperty(child, 'ResourceDictionary', 'ThemeDictionaries', context)) {
      for (const themed of elements(child)) {
        const theme = directive(themed, 'Key');
        if (!theme) throw xamlFault('SFXAML070', 'Theme dictionaries require x:Key.', themed);
        dictionary.setTheme(theme, buildResourceDictionary(themed, {...context, resources: scope}));
      }
      continue;
    }
    let key = directive(child, 'Key');
    if (key !== undefined && key.startsWith('{')) key = literal(key, 'object', child, context);
    if (key === undefined && child.localName === 'Style') {
      const target = attribute(child, 'TargetType');
      if (!target) throw xamlFault('SFXAML071', 'An implicit style requires TargetType.', child);
      key = target.startsWith('{') ? literal(target, 'System.Type', child, context) : typeToken(target, child, context);
    }
    if (key === undefined) throw xamlFault('SFXAML072', 'Resource entries require x:Key or an implicit Style.TargetType.', child);
    const limits = new Map(context.resourceLimits ?? []);
    limits.set(dictionary, dictionary.count);
    const deferred = new DeferredResource(() => context.writer.build(child, {
      ...context, resources: scope, resourceLimits: limits
    }), {retainedValues: function* () { yield context.resources?.owner; }});
    context.schema.remember(deferred, {node: child});
    dictionary.add(key, deferred);
  }
  return dictionary;
}

export function buildStyle(node, context) {
  validateAttributes(node, ['TargetType', 'BasedOn']);
  const target = attribute(node, 'TargetType');
  if (!target) throw xamlFault('SFXAML071', 'Style.TargetType is required.', node);
  const targetType = target.startsWith('{') ? literal(target, 'System.Type', node, context) : typeToken(target, node, context);
  const basedOnText = attribute(node, 'BasedOn');
  let basedOn = basedOnText ? literal(basedOnText, 'object', node, context) : null;
  if (basedOn instanceof ResourceReference) basedOn = context.resources.find(basedOn.key, {maxEntries: context.resourceLimits});
  let assignedBase = basedOnText !== undefined;
  const setters = [];
  for (const child of elements(node)) {
    if (resourceProperty(child, 'Style', 'BasedOn', context)) {
      if (assignedBase || elements(child).length !== 1) throw xamlFault('SFXAML057', 'Style.BasedOn requires one assignment.', child);
      basedOn = context.writer.build(elements(child)[0], context);
      assignedBase = true;
    } else if (resourceProperty(child, 'Style', 'Setters', context)) {
      for (const setter of elements(child)) setters.push(buildSetter(setter, {...context, styleTargetType: targetType}));
    } else if (resourceType(child, context) === 'Microsoft.UI.Xaml.Setter') {
      setters.push(buildSetter(child, {...context, styleTargetType: targetType}));
    }
    else throw xamlFault('SFXAML073', 'Style content must contain setters.', child);
  }
  const style = new Style(targetType, {basedOn, setters});
  context.schema.remember(style, {type: context.descriptor, node});
  return style;
}

export function buildSetter(node, context) {
  validateAttributes(node, ['Property', 'Target', 'Value']);
  if (resourceType(node, context) !== 'Microsoft.UI.Xaml.Setter') {
    throw xamlFault('SFXAML074', 'Setter collection contains an unsupported object.', node);
  }
  const propertyName = attribute(node, 'Property');
  const target = attribute(node, 'Target') ?? null;
  if (!propertyName && !target) throw xamlFault('SFXAML074', 'Setter requires Property or Target.', node);
  const token = context.writer.services.propertyFor?.(context.styleTargetType, propertyName) ?? propertyName;
  const propertyType = token?.propertyType ?? context.schema.property(context.schema.type(context.styleTargetType), propertyName)?.type ?? 'object';
  const text = attribute(node, 'Value');
  const children = elements(node);
  if (text !== undefined && children.length) throw xamlFault('SFXAML057', 'Setter.Value was assigned more than once.', node);
  let value;
  if (text !== undefined) value = literal(text, propertyType, node, context);
  else {
    const property = children[0];
    const values = property?.localName === 'Setter.Value' ? elements(property) : children;
    if (values.length !== 1) throw xamlFault('SFXAML074', 'Setter.Value requires one value.', node);
    value = context.writer.build(values[0], context);
  }
  return new Setter(token, value, {target});
}

/** Deferred templates capture syntax and lexical resources, never a mutable prototype visual. */
export function buildTemplate(node, context) {
  validateAttributes(node, ['TargetType']);
  const children = elements(node);
  if (children.length !== 1) throw xamlFault('SFXAML075', 'A template requires exactly one visual root.', node);
  const targetText = attribute(node, 'TargetType');
  const targetType = targetText ? targetText.startsWith('{')
    ? literal(targetText, 'System.Type', node, context) : typeToken(targetText, node, context) : null;
  const factory = templateContext => {
    const afterBuild = [];
    const root = context.writer.build(children[0], {...context, afterBuild,
      root: node.localName === 'DataTemplate' ? templateContext.data : context.root ?? templateContext.owner,
      target: null, namescope: templateContext.namescope,
      resources: templateContext.resources ?? context.resources, lifetime: templateContext.lifetime,
      templateContext, signal: templateContext.signal});
    for (let index = 0; index < afterBuild.length; index++) {
      if (index >= 100_000) throw xamlFault('SFXAML048', 'Template initialization callback limit exceeded.', node);
      afterBuild[index]();
    }
    return root;
  };
  const template = node.localName === 'ControlTemplate' ? new ControlTemplate(factory, {targetType}) :
    node.localName === 'ItemsPanelTemplate' ? new ItemsPanelTemplate(factory) : new DataTemplate(factory);
  context.schema.remember(template, {type: context.descriptor, node});
  return template;
}

/** Register special resource/template construction ahead of a host's general framework-type registrations. */
export function registerXamlResourceTypes(schema) {
  const prefix = 'Microsoft.UI.Xaml.';
  for (const [name, build] of [['ResourceDictionary', buildResourceDictionary], ['Style', buildStyle],
    ['Setter', buildSetter], ['DataTemplate', buildTemplate], ['Controls.ControlTemplate', buildTemplate],
    ['Controls.ItemsPanelTemplate', buildTemplate]]) {
    const attributeNames = name === 'Style' ? ['TargetType', 'BasedOn'] : name === 'Setter'
      ? ['Property', 'Target', 'Value'] : name.includes('Template') ? ['TargetType'] : [];
    const propertyElements = name === 'Style' ? ['BasedOn', 'Setters'] : name === 'Setter'
      ? ['Value'] : name === 'ResourceDictionary' ? ['MergedDictionaries', 'ThemeDictionaries'] : [];
    schema.register({name: prefix + name, namespace: PRESENTATION_NAMESPACE, build,
      kind: name.includes('Template') ? 'template' : 'resource', attributeNames, propertyElements});
  }
  for (const [localName, type] of [['String', 'string'], ['Double', 'double'], ['Int32', 'int'], ['Boolean', 'bool']]) {
    schema.register({name: 'System.' + localName, namespace: XAML_NAMESPACE, localName, kind: 'value',
      build: (node, context) => {
        const text = node.children.filter(child => child.kind === 'text').map(child => child.value).join('');
        return type === 'string' ? text : literal(text.trim(), type, node, context);
      }});
  }
  schema.register({name: 'Windows.UI.Color', localName: 'Color', kind: 'value',
    build: (node, context) => literal(node.children.filter(child => child.kind === 'text').map(child => child.value).join('').trim(),
      'Windows.UI.Color', node, context)});
  schema.register({name: 'System.Null', localName: 'Null', namespace: XAML_NAMESPACE, kind: 'value', build: () => null});
  return schema;
}
