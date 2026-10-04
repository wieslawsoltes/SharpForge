import {Binding, BindingMode, UpdateSourceTrigger, RelativeSource, RelativeSourceMode} from '../binding/binding.js';
import {ResourceReference} from '../resources/reference.js';
import {xamlFault} from './diagnostics.js';
import {XAML_NAMESPACE} from './xml-reader.js';

/** Parse nested markup extensions and quoted values without executing user-provided expressions. */
export function parseMarkupExtension(text, {maxLength = 65536, maxDepth = 32, span = null} = {}) {
  if (text.startsWith('{}')) return text.slice(2);
  if (!text.startsWith('{')) return text;
  if (text.length > maxLength) throw xamlFault('SFXAML040', 'Markup extension length budget exceeded.', {span});
  let offset = 0;
  const whitespace = () => { while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++; };
  const word = () => {
    const start = offset;
    while (offset < text.length && !/[\s={},]/.test(text[offset])) offset++;
    if (start === offset) throw xamlFault('SFXAML041', 'Expected a markup extension name.', {span});
    return text.slice(start, offset);
  };
  const value = (depth, expression = false) => {
    whitespace();
    if (text[offset] === '{') return extension(depth + 1);
    const quote = text[offset];
    if (!expression && (quote === '"' || quote === "'")) {
      offset++;
      let result = '';
      while (offset < text.length && text[offset] !== quote) {
        if (text[offset] === '\\') {
          offset++;
          if (offset === text.length) throw xamlFault('SFXAML041', 'Unclosed quoted markup extension value.', {span});
        }
        result += text[offset++];
      }
      if (text[offset++] !== quote) throw xamlFault('SFXAML041', 'Unclosed quoted markup extension value.', {span});
      return result;
    }
    const start = offset;
    const nesting = [];
    let string = null;
    while (offset < text.length) {
      const character = text[offset];
      if (string) {
        if (character === '\\') { offset += 2; continue; }
        if (character === string) string = null;
      } else if (character === '"' || character === "'") string = character;
      else if (character === '(' || character === '[') {
        nesting.push(character);
        if (nesting.length + depth > maxDepth) throw xamlFault('SFXAML040', 'Expression nesting budget exceeded.', {span});
      } else if (character === ')' || character === ']') {
        if (nesting.pop() !== (character === ')' ? '(' : '[')) throw xamlFault('SFXAML041', 'Unbalanced expression delimiters.', {span});
      } else if (!nesting.length && (character === ',' || character === '}')) break;
      offset++;
    }
    if (string || nesting.length) throw xamlFault('SFXAML041', 'Unclosed markup expression.', {span});
    return text.slice(start, offset).trim();
  };
  const extension = depth => {
    if (depth > maxDepth) throw xamlFault('SFXAML040', 'Markup extension nesting budget exceeded.', {span});
    offset++;
    whitespace();
    const name = word();
    const argumentsList = [];
    const properties = Object.create(null);
    whitespace();
    while (offset < text.length && text[offset] !== '}') {
      const start = offset;
      let property = null;
      if (text[offset] !== '{' && text[offset] !== '"' && text[offset] !== "'") {
        const candidate = word();
        whitespace();
        if (text[offset] === '=') { property = candidate; offset++; }
        else offset = start;
      }
      const argument = value(depth, !property && name.endsWith(':Bind'));
      if (property) {
        if (Object.hasOwn(properties, property)) throw xamlFault('SFXAML041', `Duplicate extension property '${property}'.`, {span});
        properties[property] = argument;
      } else {
        if (Object.keys(properties).length) throw xamlFault('SFXAML041', 'Positional arguments must precede named extension properties.', {span});
        argumentsList.push(argument);
      }
      whitespace();
      if (text[offset] === ',') {
        offset++;
        whitespace();
        if (text[offset] === '}') throw xamlFault('SFXAML041', 'Trailing extension separators are not permitted.', {span});
      }
      else if (text[offset] !== '}') throw xamlFault('SFXAML041', 'Expected comma or closing markup extension brace.', {span});
    }
    if (text[offset++] !== '}') throw xamlFault('SFXAML041', 'Unclosed markup extension.', {span});
    return Object.freeze({kind: 'MarkupExtension', name, arguments: Object.freeze(argumentsList), properties: Object.freeze(properties)});
  };
  const result = extension(0);
  whitespace();
  if (offset !== text.length) throw xamlFault('SFXAML041', 'Unexpected text after a markup extension.', {span});
  return result;
}

function oneArgument(node, context, property = null) {
  if (node.arguments.length > 1 || Object.keys(node.properties).some(key => key !== property)) {
    throw xamlFault('SFXAML042', 'Invalid markup extension argument list.', context);
  }
  const value = node.arguments[0] ?? node.properties[property];
  if (value === undefined) throw xamlFault('SFXAML042', 'Markup extension argument is required.', context);
  return value;
}

function binding(node, context, resolve) {
  if (node.arguments.length > 1) throw xamlFault('SFXAML042', 'Binding accepts at most one positional Path.', context);
  const allowed = new Set(['Path', 'Source', 'ElementName', 'RelativeSource', 'Mode', 'Converter', 'ConverterParameter',
    'ConverterLanguage', 'FallbackValue', 'TargetNullValue', 'UpdateSourceTrigger']);
  const values = {};
  const originalValues = new Map();
  if (node.arguments.length) values.Path = node.arguments[0];
  for (const [key, value] of Object.entries(node.properties)) {
    if (!allowed.has(key) || Object.hasOwn(values, key)) throw xamlFault('SFXAML042', `Unknown or duplicate Binding property '${key}'.`, context);
    const resolved = resolve(value);
    values[key] = resolved instanceof ResourceReference
      ? context.resources.find(resolved.key, {maxEntries: context.resourceLimits}) : resolved;
    originalValues.set(key, {expression: value, value: values[key]});
  }
  for (const [key, members] of [['Mode', BindingMode], ['UpdateSourceTrigger', UpdateSourceTrigger]]) {
    if (values[key] === undefined) continue;
    if (!Object.hasOwn(members, values[key])) throw xamlFault('SFXAML042', `Invalid Binding.${key}.`, context);
    values[key] = members[values[key]];
  }
  const result = new Binding(values);
  context.rememberBinding?.(result, {markup: node, originalValues});
  return result;
}

/** The extension table is closed by default. Host-defined entries must be explicitly registered in the schema. */
export function resolveMarkupExtension(node, context = {}) {
  if (node?.kind !== 'MarkupExtension') return node;
  const separator = node.name.indexOf(':');
  const name = separator > 0 && context.namespaces?.get(node.name.slice(0, separator)) === XAML_NAMESPACE
    ? 'x:' + node.name.slice(separator + 1) : node.name;
  const resolve = value => resolveMarkupExtension(value, context);
  const handlers = {
    StaticResource: () => {
      const key = resolve(oneArgument(node, context, 'ResourceKey'));
      if (context.deferResources) return new ResourceReference(key);
      return context.resources.find(key, {maxEntries: context.resourceLimits});
    },
    ThemeResource: () => new ResourceReference(resolve(oneArgument(node, context, 'ResourceKey')), {dynamic: true}),
    Binding: () => binding(node, context, resolve),
    TemplateBinding: () => Object.freeze({kind: 'TemplateBinding', property: resolve(oneArgument(node, context, 'Property'))}),
    RelativeSource: () => {
      const mode = oneArgument(node, context, 'Mode');
      if (!Object.hasOwn(RelativeSourceMode, mode)) throw xamlFault('SFXAML042', 'Unknown RelativeSource mode.', context);
      return new RelativeSource(RelativeSourceMode[mode]);
    },
    'x:Null': () => {
      if (node.arguments.length || Object.keys(node.properties).length) throw xamlFault('SFXAML042', 'x:Null has no arguments.', context);
      return null;
    },
    'x:Type': () => {
      const type = context.resolveType?.(oneArgument(node, context, 'TypeName'));
      if (!type) throw xamlFault('SFXAML043', 'x:Type references a type outside the closed registry.', context);
      return type;
    },
    'x:Bind': () => {
      if (!context.compileBinding) throw xamlFault('SFXAML047', 'x:Bind requires the compiler token-resolution capability.', context);
      return context.compileBinding(node, context);
    }
  };
  const handler = handlers[name] ?? context.extensions?.get(name);
  if (!handler) throw xamlFault('SFXAML044', `Markup extension '${name}' is not allowed.`, context);
  return handlers[name] ? handler() : handler(node, context);
}
