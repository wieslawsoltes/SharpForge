import {BindingBase} from '../binding/binding.js';
import {ResourceReference} from '../resources/reference.js';
import {ResourceScope} from '../resources/resource-scope.js';
import {ResourceDictionary} from '../resources/resource-dictionary.js';
import {NameScope} from '../templates/name-scope.js';
import {DisposableScope} from '../object-model/disposable-scope.js';
import {ValueSource} from '../property/property-store.js';
import {parseXaml, XAML_NAMESPACE, XMLNS_NAMESPACE, XML_NAMESPACE, COMPATIBILITY_NAMESPACE} from './xml-reader.js';
import {parseMarkupExtension, resolveMarkupExtension} from './markup-extensions.js';
import {convertXamlValue} from './type-converters.js';
import {XamlParseException, xamlFault} from './diagnostics.js';
import {appendXamlNode} from './deferred-writer.js';
import {withUIConstruction} from '../object-model/construction-roots.js';

/** XAML object writing is separate from XML parsing and can only call registered constructors/setters. */
export class XamlObjectWriter {
  constructor(schema, services = {}) {
    this.schema = schema;
    this.services = services;
  }

  load(text, options = {}) {
    return withUIConstruction(this.services, () => this.loadDocument(text, options), [options.root, options.codeBehind]);
  }

  loadDocument(text, options) {
    const syntax = parseXaml(text, options);
    this.schema.validate(syntax.root, {initialTemplateValidation: options.initialTemplateValidation === true,
      deferredElements: !!this.services.deferElement});
    const lifetime = new DisposableScope();
    const namescope = options.namescope ?? new NameScope();
    if (!options.namescope) lifetime.add(namescope);
    const context = {...options, root: options.root ?? options.codeBehind ?? null, afterBuild: [], lifetime,
      namescope, schema: this.schema, writer: this,
      resources: options.resources ?? new ResourceScope()};
    if (!options.resources) lifetime.add(context.resources);
    try {
      const root = this.build(syntax.root, context);
      for (let index = 0; index < context.afterBuild.length; index++) {
        if (index >= 100_000) throw xamlFault('SFXAML048', 'XAML initialization callback limit exceeded.', syntax.root);
        context.afterBuild[index]();
      }
      context.afterBuild.length = 0;
      this.schema.remember(root, {...this.schema.metadata.get(root), sourceSyntax: syntax.root, lifetime, namescope});
      return {root, lifetime, namescope, syntax};
    } catch (error) {
      lifetime.dispose();
      if (error instanceof XamlParseException) throw error;
      throw xamlFault('SFXAML050', error.message, syntax.root, error);
    }
  }

  build(node, context) {
    context.signal?.throwIfAborted();
    if (node.kind !== 'startElement') return null;
    if (context.deferredActivation !== node && node.attributes.some(attribute =>
      attribute.namespace === XAML_NAMESPACE && attribute.localName === 'Load')) {
      throw xamlFault('SFXAML062', 'x:Load requires a child insertion point and cannot decorate this root or resource.', node);
    }
    const descriptor = this.schema.resolve(node.namespace, node.localName);
    if (!descriptor && node.ignorable.has(node.namespace)) return null;
    if (!descriptor) throw xamlFault('SFXAML045', `Unknown XAML type '${node.qualifiedName}'.`, node);
    if (descriptor.build) return descriptor.build(node, {...context, descriptor});
    if (typeof descriptor.create !== 'function') throw xamlFault('SFXAML051', 'The XAML type has no approved constructor.', node);
    const instance = descriptor.create({context, node});
    context.root ??= instance;
    if (instance?.then) throw xamlFault('SFXAML052', 'XAML constructors must complete synchronously.', node);
    if (this.services.dispose) context.lifetime.add(options => {
      if (options?.preserveValues) return;
      // TemplateInstance disconnects subscriptions first, then detaches and disposes its visuals exactly once.
      if (options?.templateDisposal && context.templateContext?.adapter.isVisual?.(instance)) return;
      this.services.dispose(instance);
    });
    const childContext = {...context, target: instance, type: descriptor, node, namespaces: node.namespaces};
    const phase = node.attributes.find(attribute => attribute.namespace === XAML_NAMESPACE && attribute.localName === 'Phase');
    if (phase) {
      if (!/^\d+$/.test(phase.value) || Number(phase.value) > 1024) throw xamlFault('SFXAML049', 'x:Phase must be an integer from 0 to 1024.', phase);
      childContext.phase = Number(phase.value);
    }
    const metadata = {type: descriptor, node, values: new Map(), children: [], resourceScope: null};
    this.schema.remember(instance, metadata);
    try {
      this.applyName(node, instance, childContext);
      const assigned = new Set();
      const localResources = node.children.filter(child => child.kind === 'startElement' && child.localName.endsWith('.Resources'));
      for (const child of localResources) this.propertyElement(child, instance, childContext, assigned);
      for (const attribute of node.attributes) this.attribute(attribute, instance, childContext, assigned);
      for (const child of node.children) {
        if (localResources.includes(child)) continue;
        if (child.kind === 'startElement' && child.localName.includes('.')) {
          this.propertyElement(child, instance, childContext, assigned);
        } else if (child.kind === 'startElement') {
          const {property, key} = this.contentTarget(descriptor, child);
          appendXamlNode(this, child, instance, property, childContext, key);
        } else if (child.kind === 'text') {
          const value = node.preserveSpace ? child.value : child.value.replace(/\s+/g, ' ').trim();
          if (value) this.content(instance, descriptor, value, childContext, child);
        }
      }
      this.localize(node, instance, childContext);
      return instance;
    } catch (error) {
      if (error instanceof XamlParseException) throw error;
      throw xamlFault('SFXAML050', error.message, node, error);
    }
  }

  applyName(node, instance, context) {
    const names = node.attributes.filter(attribute => attribute.namespace === XAML_NAMESPACE && attribute.localName === 'Name');
    const standard = node.attributes.find(attribute => !attribute.namespace && attribute.localName === 'Name');
    if (names.length && standard) throw xamlFault('SFXAML053', 'Name and x:Name cannot both be assigned.', node);
    const name = names[0]?.value ?? standard?.value;
    if (!name) return;
    context.namescope.registerName(name, instance);
    context.lifetime.add(options => {
      if (!options?.preserveValues && context.namescope.peekName(name) === instance) context.namescope.unregisterName(name);
    });
    const property = this.schema.property(context.type, 'Name');
    if (property) this.assign(instance, property, name, context, 'Name');
    this.services.setNameScope?.(instance, context.namescope);
  }

  localize(node, instance, context) {
    const uid = node.attributes.find(attribute => attribute.namespace === XAML_NAMESPACE && attribute.localName === 'Uid')?.value;
    if (!uid) return;
    this.schema.metadata.get(instance).uid = uid;
    if (!this.services.localize) return;
    const lease = this.services.localize(uid, (name, text) => {
      const {property, key} = this.resolveProperty(name, '', context, node);
      if (property.event || !property.set) throw xamlFault('SFXAML064', 'Localized resources require a writable property.', node);
      const value = convertXamlValue(text, property.type, {type: type => this.schema.type(type), converters: this.schema.converters,
        span: node.span, parseGeometry: this.schema.parseGeometry});
      this.assign(instance, property, this.services.materialize?.(property.type, value) ?? value, context, key);
    }, instance);
    if (lease) context.lifetime.add(lease);
  }

  attribute(attribute, instance, context, assigned) {
    if ([XMLNS_NAMESPACE, XML_NAMESPACE, COMPATIBILITY_NAMESPACE, XAML_NAMESPACE].includes(attribute.namespace)) return;
    if (attribute.localName === 'Name' && !attribute.namespace) return;
    if (attribute.namespace && context.node?.ignorable.has(attribute.namespace)) return;
    const {property, key} = this.resolveProperty(attribute.localName, attribute.namespace, context, attribute);
    this.ensureUnassigned(assigned, key, attribute);
    const value = this.literal(attribute.value, property.type, {...context, span: attribute.span});
    this.assign(instance, property, value, context, key);
  }

  resolveProperty(name, namespace, context, node) {
    const separator = name.indexOf('.');
    if (separator < 0) {
      const property = this.schema.property(context.type, name);
      if (!property) throw xamlFault('SFXAML054', `Unknown property '${context.type.name}.${name}'.`, node);
      return {property, key: name};
    }
    const ownerName = name.slice(0, separator);
    const propertyName = name.slice(separator + 1);
    const owner = this.schema.resolve(namespace || context.type.namespace, ownerName);
    const property = owner && this.schema.property(owner, propertyName);
    if (!property || !property.attached && !this.assignable(owner, context.type)) {
      throw xamlFault('SFXAML054', `Unknown attached or property-element member '${name}'.`, node);
    }
    return {property, key: property.attached ? owner.name + '.' + propertyName : propertyName};
  }

  assignable(target, source) {
    const visited = new Set();
    for (let type = source; type && !visited.has(type); type = this.schema.type(type.base)) {
      if (type === target) return true;
      visited.add(type);
    }
    return false;
  }

  propertyElement(node, instance, context, assigned) {
    const {property, key} = this.resolveProperty(node.localName, node.namespace, context, node);
    this.ensureUnassigned(assigned, key, node);
    const elements = node.children.filter(child => child.kind === 'startElement');
    if (property.type === 'Microsoft.UI.Xaml.ResourceDictionary' &&
      !(elements.length === 1 && elements[0].localName === 'ResourceDictionary')) {
      const wrapper = {...node, localName: 'ResourceDictionary', qualifiedName: 'ResourceDictionary', attributes: []};
      return this.assignDictionary(instance, property, this.build(wrapper, context), context, key);
    }
    if (property.collection && !(elements.length === 1 && this.schema.resolve(elements[0].namespace, elements[0].localName)?.name === property.type)) {
      for (const child of elements) appendXamlNode(this, child, instance, property, context, key);
      return;
    }
    if (elements.length > 1) throw xamlFault('SFXAML055', 'Scalar property elements accept one object.', node);
    const text = node.children.filter(child => child.kind === 'text').map(child => child.value).join('');
    if (elements.length && text.trim()) throw xamlFault('SFXAML055', 'Property element cannot mix text and object values.', node);
    if (elements.length) return appendXamlNode(this, elements[0], instance, property, context, key);
    const value = this.literal(text.trim(), property.type, {...context, span: node.span});
    this.assignDictionary(instance, property, value, context, key);
  }

  assignDictionary(instance, property, value, context, key) {
    this.assign(instance, property, value, context, key);
    if (value instanceof ResourceDictionary && key === 'Resources') {
      const scope = this.services.resourceScopeFor?.(instance) ?? new ResourceScope({resources: value, parent: context.resources, owner: instance});
      scope.setResources(value);
      context.resources = scope;
      this.schema.metadata.get(instance).resourceScope = scope;
      context.lifetime.add(scope);
    }
  }

  content(instance, descriptor, value, context, node) {
    let type = descriptor;
    while (type && !type.contentProperty && !type.add) type = this.schema.type(type.base);
    if (type?.add) {
      type.add(instance, value, context);
      this.schema.metadata.get(instance).children.push(value);
      return;
    }
    const name = type?.contentProperty;
    const property = name && this.schema.property(descriptor, name);
    if (!property) throw xamlFault('SFXAML056', `Type '${descriptor.name}' has no declared content property.`, node);
    if (property.collection) this.add(instance, property, value, context, name);
    else {
      const metadata = this.schema.metadata.get(instance);
      if (metadata.values.has(name)) throw xamlFault('SFXAML057', 'Content property was assigned more than once.', node);
      const converted = typeof value === 'string' ? this.literal(value, property.type, {...context, span: node.span}) : value;
      this.assign(instance, property, converted, context, name);
    }
  }

  contentTarget(descriptor, node) {
    let type = descriptor;
    while (type && !type.contentProperty && !type.add) type = this.schema.type(type.base);
    if (type?.add) return {property: {name: '$content', type: 'object', collection: true,
      add: type.add, insert: type.insert, remove: type.remove}, key: '$content'};
    const name = type?.contentProperty;
    const property = name && this.schema.property(descriptor, name);
    if (!property) throw xamlFault('SFXAML056', `Type '${descriptor.name}' has no declared content property.`, node);
    return {property, key: name};
  }

  literal(text, targetType, context) {
    const parsed = parseMarkupExtension(text, context);
    const extensionContext = {...context, extensions: this.schema.extensions, deferResources: true,
      compileBinding: this.services.compileBinding, rememberBinding: (binding, metadata) => this.schema.remember(binding, metadata),
      resolveType: name => this.schema.resolveQualifiedName(name, context.type?.node?.namespaces ?? context.namespaces ??
        this.schema.metadata.get(context.target)?.node?.namespaces ?? new Map(), context.span)};
    if (parsed?.kind === 'MarkupExtension') {
      const result = resolveMarkupExtension(parsed, extensionContext);
      return targetType === 'System.Type' && result?.name && this.services.materializeType
        ? this.services.materializeType(result) : result;
    }
    const value = convertXamlValue(parsed, targetType, {...extensionContext,
      type: name => this.schema.type(name), converters: this.schema.converters, parseGeometry: this.schema.parseGeometry});
    return this.services.materialize?.(targetType, value) ?? value;
  }

  assign(instance, property, value, context, key) {
    if (value instanceof BindingBase) {
      if (!this.services.bind) throw xamlFault('SFXAML058', 'Binding requires a registered object-writer binding adapter.', context);
      context.lifetime.add(this.services.bind({target: instance, property, binding: value, context}));
    } else if (value instanceof ResourceReference) this.assignResource(instance, property, value, context);
    else if (value?.kind === 'TemplateBinding') this.assignTemplateBinding(instance, property, value, context);
    else {
      if (typeof property.set !== 'function') throw xamlFault('SFXAML059', `Property '${key}' is read-only.`, context);
      property.set(instance, value, context);
    }
    this.schema.metadata.get(instance)?.values.set(key, value);
  }

  assignResource(instance, property, reference, context) {
    const store = this.services.storeFor?.(instance);
    const token = property.property ?? property.token;
    const materialize = value => this.services.materializeResource
      ? this.services.materializeResource(value, property.type) : this.services.materialize?.(property.type, value) ?? value;
    if (reference.dynamic && store && token) {
      context.lifetime.add(context.resources.observe(reference, {
        validate: value => store.validateValue(token, materialize(value), {coerce: false}),
        changed: value => store.setSource(token, ValueSource.Local, materialize(value))
      }));
    } else {
      const value = context.resources.find(reference.key, {maxEntries: context.resourceLimits});
      this.assign(instance, property, materialize(value), context, property.name);
    }
  }

  assignTemplateBinding(instance, property, expression, context) {
    if (!context.templateContext) throw xamlFault('SFXAML060', 'TemplateBinding is only permitted in a template factory.', context);
    const ownerStore = this.services.storeFor?.(context.templateContext.owner);
    const targetStore = this.services.storeFor?.(instance);
    const source = ownerStore?.registry.lookup(ownerStore.ownerType, expression.property);
    const target = property.property ?? targetStore?.registry.lookup(targetStore.ownerType, property.name);
    if (!source || !target) throw xamlFault('SFXAML060', 'Unknown TemplateBinding property.', context);
    context.templateContext.bind(instance, target, source);
  }

  add(instance, property, value, context, key) {
    if (value === null) return;
    if (!property.add) throw xamlFault('SFXAML061', `Collection property '${key}' has no registered Add adapter.`, context);
    property.add(instance, value, context);
    const metadata = this.schema.metadata.get(instance);
    let collection = metadata.values.get(key);
    if (!collection) metadata.values.set(key, collection = []);
    collection.push(value);
  }

  ensureUnassigned(assigned, key, node) {
    if (assigned.has(key)) throw xamlFault('SFXAML057', `Property '${key}' is assigned more than once.`, node);
    assigned.add(key);
  }
}
