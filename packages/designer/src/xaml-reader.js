import { parseXmlCst } from '@sharpforge/project-system';
import { validateDesign, childSlot, propertySchema, track } from './model.js';
import { XAML_XMLNS, PRESENTATION_XMLNS, DESIGN_XMLNS, MARKUP_XMLNS, xmlName, xamlControl, xamlMember, readXamlValue, xamlError } from './xaml-values.js';

const identifier = /^[A-Za-z_]\w*$/;
const className = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const elements = node => node.children.filter(child => child.kind === 'element');

function namespacesFor(element, parent) {
  const namespaces = new Map(parent);
  for (const attribute of element.attributes) {
    if (attribute.name === 'xmlns') namespaces.set('', attribute.value);
    else if (attribute.name.startsWith('xmlns:')) namespaces.set(attribute.name.slice(6), attribute.value);
  }
  return namespaces;
}

export function isXamlMetadata(attribute, namespaces) {
  if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) return true;
  const resolved = xmlName(attribute.name, namespaces);
  if ([DESIGN_XMLNS, MARKUP_XMLNS].includes(resolved.namespace)) return true;
  return resolved.namespace === XAML_XMLNS && ['Class', 'ClassModifier', 'Uid'].includes(resolved.name);
}

function gridTracks(element, axis, namespaces) {
  const kind = axis === 'rows' ? 'RowDefinition' : 'ColumnDefinition';
  const member = axis === 'rows' ? 'Height' : 'Width';
  return elements(element).map(child => {
    const resolved = xmlName(child.name, namespacesFor(child, namespaces));
    if (resolved.name !== kind || ![PRESENTATION_XMLNS, 'using:Microsoft.UI.Xaml.Controls'].includes(resolved.namespace) ||
      child.attributes.some(attribute => attribute.name !== member) || elements(child).length) {
      throw xamlError('SFXAML006', 'Grid definitions support only ' + kind + '.' + member, child);
    }
    try { return track(child.attributes.find(attribute => attribute.name === member)?.value ?? '*'); }
    catch (error) { throw xamlError('SFXAML004', error.message, child); }
  });
}

/** Parse only the registered literal WinUI profile; XML entities, paths and code are never executed. */
export function readDesignXaml(text, options = {}) {
  const { uri = 'View.xaml', previous, signal, maxLength = 1024 * 1024, maxNodes = 1000, maxDepth = 80, identityHints } = options;
  for (const value of [maxLength, maxNodes, maxDepth]) {
    if (!Number.isSafeInteger(value) || value < 1) throw xamlError('SFXAML008', 'Invalid XAML designer limit');
  }
  let cst;
  try { cst = parseXmlCst(text, { maxLength, maxNodes: maxNodes * 6, maxDepth, signal }); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw xamlError('SFXAML001', error.message, error.offset ?? 0);
  }
  const nodes = [];
  const bindings = Object.create(null);
  const names = new Set();
  const declaredNames = new Set();
  let counter = 0;
  let owner = null;
  const allNames = new Set();
  const collectNames = element => {
    for (const attribute of element.attributes) if (attribute.name === 'Name' || attribute.name.endsWith(':Name')) allNames.add(attribute.value);
    for (const child of elements(element)) collectNames(child);
  };
  collectNames(cst.root);

  function visit(element, parentNamespaces, route = '0') {
    signal?.throwIfAborted();
    if (nodes.length >= maxNodes) throw xamlError('SFXAML008', 'XAML control count limit exceeded', element);
    const namespaces = namespacesFor(element, parentNamespaces);
    const type = xamlControl(element.name, namespaces, element);
    const named = element.attributes.find(attribute => attribute.name === 'Name' ||
      xmlName(attribute.name, namespaces).namespace === XAML_XMLNS && attribute.name.endsWith(':Name'));
    let id = identityHints?.[route] ?? named?.value;
    if (named && (!identifier.test(named.value) || declaredNames.has(named.value))) {
      throw xamlError('SFXAML006', 'XAML names must be unique identifiers', named);
    }
    if (named) declaredNames.add(named.value);
    if (!id) do { id = 'xaml_' + ++counter; } while (allNames.has(id) || names.has(id));
    if (names.has(id)) throw xamlError('SFXAML006', 'Duplicate XAML design identity: ' + id, element);
    names.add(id);
    const node = { id, type, properties: {}, events: {}, children: [] };
    const binding = { element, namespaces, properties: {}, events: {}, route, identityAttribute: named ?? null };
    nodes.push(node);
    bindings[id] = binding;
    for (const attribute of element.attributes) {
      if (isXamlMetadata(attribute, namespaces)) {
        if (xmlName(attribute.name, namespaces).namespace === XAML_XMLNS && attribute.name.endsWith(':Class')) {
          if (element !== cst.root || !className.test(attribute.value)) throw xamlError('SFXAML006', 'Invalid root x:Class', attribute);
          owner = attribute.value;
        }
        continue;
      }
      const member = xamlMember(type, attribute, namespaces);
      if (binding.properties[member.name] || binding.events[member.name]) throw xamlError('SFXAML006', 'Duplicate XAML member', attribute);
      if (member.name === 'Name' && !propertySchema(type).Name) continue;
      const target = member.kind === 'event' ? node.events : node.properties;
      target[member.name] = member.kind === 'event' ? attribute.value : readXamlValue(type, member.name, attribute.value, attribute);
      binding[member.kind === 'event' ? 'events' : 'properties'][member.name] = { kind: 'attribute', attribute };
    }
    let childIndex = 0;
    for (const child of elements(element)) {
      if (child.name.includes('.')) {
        const [qualified, member] = child.name.split('.');
        if (xamlControl(qualified, namespacesFor(child, namespaces), child) !== type) {
          throw xamlError('SFXAML006', 'Property element owner differs from its control', child);
        }
        if (type.endsWith('.Grid') && ['RowDefinitions', 'ColumnDefinitions'].includes(member)) {
          const axis = member === 'RowDefinitions' ? 'rows' : 'columns';
          if (node[axis]) throw xamlError('SFXAML006', 'Duplicate Grid definitions', child);
          node[axis] = gridTracks(child, axis, namespaces);
        } else if (member === childSlot(type)?.property) {
          for (const item of elements(child)) node.children.push(visit(item, namespacesFor(child, namespaces), route + '.' + childIndex++));
        } else throw xamlError('SFXAML004', 'Unsupported XAML property element: ' + child.name, child);
      } else node.children.push(visit(child, namespaces, route + '.' + childIndex++));
    }
    const content = element.children.filter(child => ['text', 'cdata'].includes(child.kind) && child.value.trim());
    if (content.length) {
      const property = propertySchema(type).Text ? 'Text' : childSlot(type)?.property === 'Content' ? 'Content' : null;
      if (!property || content.length !== 1 || node.children.length || Object.hasOwn(node.properties, property)) {
        throw xamlError('SFXAML006', 'Mixed XAML text content is unsupported', element);
      }
      node.properties[property] = readXamlValue(type, property, content[0].value, content[0]);
      binding.properties[property] = { kind: 'text', node: content[0] };
    }
    if (node.children.length && Object.hasOwn(node.properties, childSlot(type)?.property)) {
      throw xamlError('SFXAML006', 'A XAML content property cannot have both literal and visual content', element);
    }
    return id;
  }

  const root = visit(cst.root, new Map());
  let document;
  try {
    document = validateDesign({ version: 1, name: previous?.name ?? owner?.split('.').at(-1) ?? cst.root.name,
      width: previous?.width ?? 960, height: previous?.height ?? 640, root, nodes, styles: {}, templates: {} });
  } catch (error) { throw xamlError('SFXAML006', error.message, cst.root); }
  return { text, uri, document, bindings, cst, className: owner, method: { name: owner ?? cst.root.name },
    sourceKind: 'xaml', warnings: [], structuralEditable: true };
}
