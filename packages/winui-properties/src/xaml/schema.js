import {PRESENTATION_NAMESPACE, XAML_NAMESPACE, XML_NAMESPACE, XMLNS_NAMESPACE, COMPATIBILITY_NAMESPACE} from './xml-reader.js';
import {xamlFault} from './diagnostics.js';

/** An explicit allowlist of constructors, setters, content properties and type converters. */
export class XamlSchema {
  constructor({maxTypes = 10000} = {}) {
    this.maxTypes = maxTypes;
    this.types = new Map();
    this.byName = new Map();
    this.extensions = new Map();
    this.converters = new Map();
    this.metadata = new WeakMap();
    this.parseGeometry = null;
  }

  register({name, namespace = PRESENTATION_NAMESPACE, localName = name.slice(name.lastIndexOf('.') + 1),
    create = null, properties = {}, contentProperty = null, base = null, build = null, loadable = true,
    kind = 'object', values = null, serialize = null, add = null, ...options}) {
    if (!loadable || typeof name !== 'string' || !name) throw new TypeError('Explicit loadable XAML type metadata is required.');
    const key = namespace + '|' + localName;
    const existing = this.types.get(key) ?? this.byName.get(name);
    if (existing) {
      throw new TypeError(`XAML type '${name}' conflicts with '${existing.name}' at '${namespace}:${localName}'.`);
    }
    if (this.types.size >= this.maxTypes) throw new RangeError('XAML type registry limit exceeded.');
    const descriptor = Object.freeze({name, namespace, localName, create, properties: Object.freeze({...properties}),
      contentProperty, base, build, loadable, kind, values, serialize, add, ...options});
    this.types.set(key, descriptor);
    this.byName.set(name, descriptor);
    return descriptor;
  }

  resolve(namespace, localName) { return this.types.get(namespace + '|' + localName) ?? null; }
  type(name) { return this.byName.get(name) ?? null; }

  /** Alternate XML names refer only to descriptors already admitted to this closed registry. */
  registerAlias(namespace, localName, type) {
    const descriptor = typeof type === 'string' ? this.type(type) : type;
    if (!descriptor || this.type(descriptor.name) !== descriptor || typeof namespace !== 'string' || !namespace ||
      typeof localName !== 'string' || !localName) throw new TypeError('A registered XAML type and explicit alias are required.');
    const key = namespace + '|' + localName;
    const previous = this.types.get(key);
    if (previous === descriptor) return descriptor;
    if (previous) throw new TypeError(`XAML alias '${namespace}:${localName}' already resolves to '${previous.name}'.`);
    if (this.types.size >= this.maxTypes) throw new RangeError('XAML type registry limit exceeded.');
    this.types.set(key, descriptor);
    return descriptor;
  }

  property(type, name, {attachedOwner = null} = {}) {
    if (attachedOwner) {
      const owner = typeof attachedOwner === 'string' ? this.type(attachedOwner) : attachedOwner;
      const property = owner?.properties[name];
      return property?.attached ? property : null;
    }
    const seen = new Set();
    for (let current = type; current; current = this.type(current.base)) {
      if (seen.has(current)) throw new TypeError('Cyclic XAML schema inheritance.');
      seen.add(current);
      if (Object.hasOwn(current.properties, name)) return current.properties[name];
    }
    return null;
  }

  resolveQualifiedName(name, namespaces, span = null) {
    const separator = name.indexOf(':');
    const prefix = separator < 0 ? '' : name.slice(0, separator);
    const localName = separator < 0 ? name : name.slice(separator + 1);
    const namespace = namespaces.get(prefix) ?? (prefix ? null : PRESENTATION_NAMESPACE);
    const type = namespace ? this.resolve(namespace, localName) : null;
    if (!type) throw xamlFault('SFXAML045', `Type '${name}' is not in the XAML allowlist.`, {span});
    return type;
  }

  /** Security preflight finishes before constructing any object, including deferred subtrees. */
  validate(root, {initialTemplateValidation = false, deferredElements = false} = {}) {
    const queue = [{node: root, deferred: false}];
    while (queue.length) {
      const {node, deferred} = queue.pop();
      if (node.kind !== 'startElement') continue;
      if (node.ignorable.has(node.namespace) && !this.resolve(node.namespace, node.localName)) continue;
      if (node.namespace === XAML_NAMESPACE && ['Code', 'Class', 'FactoryMethod', 'Arguments'].includes(node.localName)) {
        throw xamlFault('SFXAML046', `x:${node.localName} is forbidden by the XAML loading policy.`, node);
      }
      const type = this.resolve(node.namespace, node.localName);
      if (!node.localName.includes('.') && !type) {
        throw xamlFault('SFXAML045', `XAML type '${node.qualifiedName}' is not in the closed registry.`, node);
      }
      for (const attribute of node.attributes) {
        if (attribute.namespace === XAML_NAMESPACE && !['Name', 'Key', 'Uid', 'Phase'].includes(attribute.localName) &&
          !(deferredElements && attribute.localName === 'Load')) {
          throw xamlFault('SFXAML046', `Directive '${attribute.qualifiedName}' is forbidden.`, attribute);
        }
      }
      if (!deferred || initialTemplateValidation) this.validateMembers(node, type);
      const childDeferred = deferred || type?.kind === 'template';
      for (const child of node.children) queue.push({node: child, deferred: childDeferred});
    }
  }

  validateMembers(node, type) {
    if (!type) {
      const separator = node.localName.indexOf('.');
      const owner = this.resolve(node.namespace, node.localName.slice(0, separator));
      const name = node.localName.slice(separator + 1);
      if (!owner || !this.property(owner, name) && !owner.propertyElements?.includes(name)) {
        throw xamlFault('SFXAML054', `Unknown property element '${node.qualifiedName}'.`, node);
      }
      return;
    }
    for (const attribute of node.attributes) {
      if ([XAML_NAMESPACE, XML_NAMESPACE, XMLNS_NAMESPACE, COMPATIBILITY_NAMESPACE].includes(attribute.namespace)) continue;
      if (node.ignorable.has(attribute.namespace)) continue;
      const separator = attribute.localName.indexOf('.');
      const owner = separator < 0 ? type : this.resolve(attribute.namespace || node.namespace, attribute.localName.slice(0, separator));
      const name = separator < 0 ? attribute.localName : attribute.localName.slice(separator + 1);
      const property = owner && this.property(owner, name);
      if ((!property || separator >= 0 && !property.attached) && !type.attributeNames?.includes(name)) {
        throw xamlFault('SFXAML054', `Unknown property '${attribute.qualifiedName}'.`, attribute);
      }
    }
  }

  remember(object, metadata) {
    if (object && typeof object === 'object') this.metadata.set(object, metadata);
    return object;
  }
}
