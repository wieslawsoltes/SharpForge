import { PRESENTATION_XMLNS, XAML_XMLNS, xamlAttributeName, writeXamlValue, escapeXaml, xamlError } from './xaml-values.js';
import { isXamlMetadata } from './xaml-reader.js';
import { propertySchema } from './model.js';

function trackText(value) {
  if (value.GridUnitType === 0) return 'Auto';
  return String(value.Value) + (value.GridUnitType === 2 ? '*' : '');
}

/** Canonical structural rewrite retains metadata and every XML comment; scalar edits use original spans instead. */
export function serializeDesignXaml(analysis, document) {
  if (Object.keys(document.styles).length || Object.keys(document.templates).length) {
    throw xamlError('SFXAML004', 'XAML resource dictionaries need a registered resource designer provider');
  }
  const newline = analysis.text.includes('\r\n') ? '\r\n' : '\n';
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const identityHints = {};
  const comments = [];
  const collect = element => {
    for (const child of element.children) {
      if (child.kind === 'comment') comments.push(analysis.text.slice(child.start, child.end));
      if (child.kind === 'element') collect(child);
    }
  };
  collect(analysis.cst.root);

  function emit(id, depth, route) {
    const node = nodes.get(id);
    const binding = analysis.bindings[id];
    const attributes = new Map();
    identityHints[route] = id;
    if (binding) for (const attribute of binding.element.attributes) {
      if (isXamlMetadata(attribute, binding.namespaces)) attributes.set(attribute.name, attribute.value);
    }
    if (binding?.identityAttribute && !Object.hasOwn(propertySchema(node.type), 'Name')) {
      attributes.set(binding.identityAttribute.name, binding.identityAttribute.value);
    }
    if (id === document.root) {
      attributes.set('xmlns', PRESENTATION_XMLNS);
      attributes.set('xmlns:x', XAML_XMLNS);
    } else if (attributes.has('xmlns')) attributes.set('xmlns', PRESENTATION_XMLNS);
    for (const [property, value] of Object.entries(node.properties)) {
      attributes.set(xamlAttributeName(property), writeXamlValue(node.type, property, value));
    }
    for (const [name, handler] of Object.entries(node.events)) attributes.set(name, handler);
    const type = node.type.split('.').at(-1);
    const indent = '  '.repeat(depth);
    const opening = indent + '<' + type + [...attributes].map(([key, value]) => ' ' + key + '="' + escapeXaml(value) + '"').join('');
    const content = [];
    if (id === document.root) for (const comment of comments) content.push(indent + '  ' + comment);
    for (const [axis, property, definition, member] of [
      ['rows', 'RowDefinitions', 'RowDefinition', 'Height'], ['columns', 'ColumnDefinitions', 'ColumnDefinition', 'Width']
    ]) if (node[axis]) {
      content.push(indent + '  <Grid.' + property + '>');
      for (const value of node[axis]) content.push(indent + '    <' + definition + ' ' + member + '="' + trackText(value) + '" />');
      content.push(indent + '  </Grid.' + property + '>');
    }
    node.children.forEach((child, index) => content.push(emit(child, depth + 1, route + '.' + index)));
    return content.length ? opening + '>' + newline + content.join(newline) + newline + indent + '</' + type + '>' : opening + ' />';
  }

  return { text: emit(document.root, 0, '0'), identityHints };
}
