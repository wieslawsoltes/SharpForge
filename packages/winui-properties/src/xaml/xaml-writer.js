import {BindingBase, RelativeSource, RelativeSourceMode, UpdateSourceTrigger} from '../binding/binding.js';
import {UnsetValue} from '../property/values.js';
import {ResourceDictionary} from '../resources/resource-dictionary.js';
import {ResourceReference, DeferredResource} from '../resources/reference.js';
import {Style, Setter} from '../styles/style.js';
import {FrameworkTemplate} from '../templates/template-factory.js';
import {XAML_NAMESPACE, PRESENTATION_NAMESPACE, XMLNS_NAMESPACE} from './xml-reader.js';
import {xamlFault} from './diagnostics.js';
import {writeXamlLiteralRecord} from './literal-writer.js';

const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = value => escapeText(value).replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
const identity = value => value;

/** Canonical, deterministic XAML serialization; runtime-only objects require an explicitly registered serializer. */
export class XamlWriter {
  constructor(schema, options = {}) {
    const {maxNodes = 200000, maxDepth = 256, typeOf = null, unwrap = identity,
      items = value => Array.from(value)} = options;
    this.schema = schema;
    this.maxNodes = maxNodes;
    this.maxDepth = maxDepth;
    this.typeOf = typeOf;
    this.unwrap = unwrap;
    this.items = items;
    // Ordinary options inherit Object.prototype.valueOf, which returns the writer instead of the supplied value.
    this.valueOf = Object.hasOwn(options, 'valueOf') && options.valueOf !== undefined ? options.valueOf : identity;
  }

  save(root) {
    this.count = 0;
    this.active = new Set();
    this.namespaces = new Map([[PRESENTATION_NAMESPACE, ''], [XAML_NAMESPACE, 'x']]);
    const body = this.object(root, 0);
    const namespaces = [...this.namespaces].map(([uri, prefix]) => ` xmlns${prefix ? ':' + prefix : ''}="${escapeAttribute(uri)}"`).join('');
    const firstClose = body.indexOf('>');
    const insertion = body[firstClose - 1] === '/' ? firstClose - 1 : firstClose;
    return body.slice(0, insertion) + namespaces + body.slice(insertion) + '\n';
  }

  tag(type) {
    let prefix = this.namespaces.get(type.namespace);
    if (prefix === undefined) {
      prefix = 'ns' + (this.namespaces.size - 1);
      this.namespaces.set(type.namespace, prefix);
    }
    return (prefix ? prefix + ':' : '') + type.localName;
  }

  object(value, depth, key = undefined) {
    value = this.unwrap(value);
    if (++this.count > this.maxNodes || depth > this.maxDepth) throw xamlFault('SFXAML080', 'XAML writer budget exceeded.');
    if (value === null) return this.element('x:Null', key === undefined ? {} : {'x:Key': this.literal(key)}, [], depth);
    if (typeof value === 'string') return this.element('x:String', key === undefined ? {} : {'x:Key': this.literal(key)}, [escapeText(value)], depth, true);
    if (typeof value === 'number' || typeof value === 'boolean') {
      return this.element(typeof value === 'boolean' ? 'x:Boolean' : 'x:Double',
        key === undefined ? {} : {'x:Key': this.literal(key)}, [String(value)], depth, true);
    }
    if (this.active.has(value)) throw xamlFault('SFXAML081', 'Cyclic object graphs cannot be serialized as XAML.');
    this.active.add(value);
    try {
      return this.referenceObject(value, depth, key);
    } finally { this.active.delete(value); }
  }

  referenceObject(value, depth, key) {
    const metadata = this.schema.metadata.get(value);
    if (value instanceof DeferredResource) {
      if (metadata?.node) return this.syntax(metadata.node, depth, key);
      if (value.state !== 'ready') throw xamlFault('SFXAML082', 'A code-first deferred resource requires a registered serializer.');
      return this.object(value.value, depth, key);
    }
    if (value instanceof ResourceDictionary) return this.dictionary(value, depth, key);
    if (value instanceof Style) return this.style(value, depth, key);
    if (value instanceof Setter) return this.setter(value, depth);
    if (value instanceof FrameworkTemplate) {
      if (!metadata?.node) throw xamlFault('SFXAML083', 'A code-first template factory cannot be reverse-engineered into XAML.');
      return this.syntax(metadata.node, depth, key);
    }
    const type = metadata?.type ?? this.schema.type(this.typeOf?.(value));
    if (!type) throw xamlFault('SFXAML084', 'Object type has no registered XAML serialization metadata.');
    if (type.serialize) return type.serialize(value, {writer: this, depth, key});
    return this.generic(value, type, metadata, depth, key);
  }

  dictionary(dictionary, depth, key) {
    const children = [];
    if (dictionary.merged.length) children.push(this.element('ResourceDictionary.MergedDictionaries', {},
      dictionary.merged.map(value => this.object(value, depth + 2)), depth + 1));
    if (dictionary.themes.size) children.push(this.element('ResourceDictionary.ThemeDictionaries', {},
      [...dictionary.themes].map(([theme, value]) => this.object(value, depth + 2, theme)), depth + 1));
    for (const [entryKey, value] of dictionary) children.push(this.object(value, depth + 1, entryKey));
    return this.element('ResourceDictionary', key === undefined ? {} : {'x:Key': this.literal(key)}, children, depth);
  }

  style(style, depth, key) {
    const targetType = typeof style.targetType === 'string' ? style.targetType : style.targetType.name;
    const type = this.schema.type(targetType);
    if (!type) throw xamlFault('SFXAML085', 'Style target type is outside the serialization registry.');
    const attributes = {TargetType: this.tag(type)};
    if (key !== undefined && key !== style.targetType) attributes['x:Key'] = this.literal(key);
    const children = style.setters.map(setter => this.setter(setter, depth + 1));
    if (style.basedOn) children.unshift(this.element('Style.BasedOn', {}, [this.object(style.basedOn, depth + 2)], depth + 1));
    return this.element('Style', attributes, children, depth);
  }

  setter(setter, depth) {
    const attributes = setter.target ? {Target: setter.target} : {Property: setter.property.name ?? setter.property};
    if (this.isLiteral(setter.value)) {
      attributes.Value = this.literal(setter.value);
      return this.element('Setter', attributes, [], depth);
    }
    return this.element('Setter', attributes,
      [this.element('Setter.Value', {}, [this.object(setter.value, depth + 2)], depth + 1)], depth);
  }

  generic(value, type, metadata, depth, key) {
    const attributes = key === undefined ? {} : {'x:Key': this.literal(key)};
    if (metadata?.uid) attributes['x:Uid'] = metadata.uid;
    const children = [];
    const names = metadata?.values ? [...metadata.values.keys()] : Object.keys(type.properties);
    names.sort();
    for (const name of names) {
      const property = this.schema.property(type, name);
      const original = metadata?.values?.get(name);
      const raw = original instanceof ResourceReference || original instanceof BindingBase ? original
        : property?.get ? property.get(value) : original;
      const current = raw instanceof ResourceReference || raw instanceof BindingBase ? raw : this.valueOf(raw, property?.type);
      if (current === undefined || property?.readOnly && !property.collection) continue;
      if (this.isLiteral(current) && !property?.collection) attributes[name] = this.literal(current);
      else {
        const values = property?.collection ? this.items(current) : [current];
        children.push(this.element(this.tag(type) + '.' + name, {}, values.map(child => this.object(child, depth + 2)), depth + 1));
      }
    }
    for (const child of metadata?.children ?? []) children.push(this.object(child, depth + 1));
    return this.element(this.tag(type), attributes, children, depth);
  }

  syntax(node, depth, key = undefined) {
    if (++this.count > this.maxNodes || depth > this.maxDepth) throw xamlFault('SFXAML080', 'XAML writer budget exceeded.');
    const tag = node.qualifiedName;
    const attributes = {};
    for (const attribute of node.attributes) {
      if (attribute.namespace === XMLNS_NAMESPACE) continue;
      attributes[attribute.qualifiedName] = attribute.value;
    }
    for (const [prefix, uri] of node.namespaces) {
      if (prefix === 'xml' || this.namespaces.get(uri) === prefix) continue;
      attributes[prefix ? 'xmlns:' + prefix : 'xmlns'] = uri;
    }
    if (key !== undefined) attributes['x:Key'] = this.literal(key);
    const children = [];
    for (const child of node.children) {
      if (child.kind === 'startElement') children.push(this.syntax(child, depth + 1));
      else if (child.kind === 'text' && (node.preserveSpace || child.value.trim())) children.push(escapeText(child.value));
    }
    return this.element(tag, attributes, children, depth, children.length === 1 && !children[0].trim().startsWith('<'));
  }

  isLiteral(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value) ||
      value instanceof ResourceReference || value instanceof BindingBase || value?.kind === 'TemplateBinding' ||
      value?.kind === 'TypeReference' || writeXamlLiteralRecord(value) !== null;
  }

  literal(value) {
    if (value === null) return '{x:Null}';
    if (value instanceof ResourceReference) return '{' + value.kind + ' ' + value.key + '}';
    if (value instanceof BindingBase) return this.binding(value);
    if (value?.kind === 'TemplateBinding') return '{TemplateBinding ' + value.property + '}';
    if (value?.kind === 'TypeReference') {
      const type = this.schema.type(value.name);
      if (!type) throw xamlFault('SFXAML085', 'Type literal is outside the serialization registry.');
      return '{x:Type ' + this.tag(type) + '}';
    }
    const record = writeXamlLiteralRecord(value);
    if (record !== null) return record;
    const text = String(value);
    return typeof value === 'string' && text.startsWith('{') ? '{}' + text : text;
  }

  binding(binding) {
    const properties = [];
    const originals = this.schema.metadata.get(binding)?.originalValues;
    const write = name => {
      const original = originals?.get(name);
      return original?.value === binding[name] && original.expression?.kind === 'MarkupExtension'
        ? this.extensionNode(original.expression) : this.extensionValue(binding[name]);
    };
    if (binding.Path) properties.push('Path=' + this.extensionValue(binding.Path));
    const modes = ['OneTime', 'OneWay', 'TwoWay', 'Default'];
    if (binding.Mode !== 1) properties.push('Mode=' + modes[binding.Mode]);
    if (binding.ElementName) properties.push('ElementName=' + this.extensionValue(binding.ElementName));
    if (binding.Source !== UnsetValue) properties.push('Source=' + write('Source'));
    if (binding.RelativeSource) properties.push('RelativeSource=' + write('RelativeSource'));
    for (const name of ['FallbackValue', 'TargetNullValue']) {
      if (binding[name] !== UnsetValue) properties.push(name + '=' + write(name));
    }
    if (binding.UpdateSourceTrigger !== UpdateSourceTrigger.Default) {
      const trigger = Object.keys(UpdateSourceTrigger).find(name => UpdateSourceTrigger[name] === binding.UpdateSourceTrigger);
      properties.push('UpdateSourceTrigger=' + trigger);
    }
    for (const name of ['Converter', 'ConverterParameter', 'ConverterLanguage']) {
      if (binding[name] === null || binding[name] === '') continue;
      if (!this.isLiteral(binding[name]) && !originals?.get(name)) {
        throw xamlFault('SFXAML086', 'Binding converter serialization requires a resource reference.');
      }
      properties.push(name + '=' + write(name));
    }
    return '{Binding' + (properties.length ? ' ' + properties.join(', ') : '') + '}';
  }

  extensionValue(value) {
    if (value instanceof ResourceReference) return this.literal(value);
    if (value instanceof RelativeSource) {
      return '{RelativeSource ' + Object.keys(RelativeSourceMode).find(name => RelativeSourceMode[name] === value.Mode) + '}';
    }
    if (!this.isLiteral(value)) throw xamlFault('SFXAML086', 'A runtime object in a Binding requires a resource reference for serialization.');
    const text = this.literal(value);
    return /[{},='"\s]/.test(text) ? "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'" : text;
  }

  extensionNode(node) {
    const parts = node.arguments.map(value => value?.kind === 'MarkupExtension' ? this.extensionNode(value) : this.extensionValue(value));
    for (const [key, value] of Object.entries(node.properties)) {
      parts.push(key + '=' + (value?.kind === 'MarkupExtension' ? this.extensionNode(value) : this.extensionValue(value)));
    }
    return '{' + node.name + (parts.length ? ' ' + parts.join(', ') : '') + '}';
  }

  element(name, attributes, children, depth, inline = false) {
    const indentation = '  '.repeat(depth);
    const attrs = Object.entries(attributes).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
    if (!children.length) return indentation + '<' + name + attrs + ' />';
    if (inline) return indentation + '<' + name + attrs + '>' + children.join('') + '</' + name + '>';
    return indentation + '<' + name + attrs + '>\n' + children.join('\n') + '\n' + indentation + '</' + name + '>';
  }
}
