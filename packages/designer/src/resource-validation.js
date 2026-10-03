import {CONTROLS, MEDIA, XAML, canonicalType, frameworkAssignable, frameworkManifest, frameworkType} from '@sharpforge/framework';
import {authoringError, boundedArray, finiteNumber, qualifiedIdentifier, resourceKey} from './property-diagnostics.js';
import {normalizeDesignerBrush} from './property-values.js';

const bindingModes = new Set(['OneTime', 'OneWay', 'TwoWay']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeDesignerBinding(value) {
  if (!record(value)) authoringError('SFD1820', 'Binding settings must be an object.');
  const path = value.path ?? '';
  if (typeof path !== 'string' || path.length > 512 || path && !/^[A-Za-z_]\w*(?:(?:\.[A-Za-z_]\w*)|(?:\[\d{1,6}\]))*$/.test(path)) {
    authoringError('SFD1820', 'Binding paths use member names and nonnegative numeric indexers.');
  }
  const mode = value.mode ?? 'OneWay';
  if (!bindingModes.has(mode)) authoringError('SFD1820', 'Binding mode must be OneTime, OneWay or TwoWay.');
  const result = {path, mode};
  if (value.converter) result.converter = resourceKey(value.converter);
  if (value.elementName) result.elementName = resourceKey(value.elementName);
  if (value.converterParameter !== undefined) {
    if (!['string', 'number', 'boolean'].includes(typeof value.converterParameter) && value.converterParameter !== null) {
      authoringError('SFD1820', 'Converter parameters must be scalar values.');
    }
    if (typeof value.converterParameter === 'number') finiteNumber(value.converterParameter);
    if (String(value.converterParameter).length > 4096) authoringError('SFD1820', 'Converter parameter text limit.');
    result.converterParameter = value.converterParameter;
  }
  return result;
}

export function normalizeResourceReference(value) {
  if (!record(value) || !['static', 'theme'].includes(value.kind)) {
    authoringError('SFD1821', 'Choose a static or theme resource reference.');
  }
  return {kind: value.kind, key: resourceKey(value.key)};
}

export function normalizeResourceValue(type, value, {normalizeProperty}) {
  type = canonicalType(type);
  if ([MEDIA + 'Brush', MEDIA + 'SolidColorBrush', MEDIA + 'LinearGradientBrush'].includes(type)) return normalizeDesignerBrush(value);
  if (type === 'string') {
    if (typeof value !== 'string' || value.length > 100000) authoringError('SFD1822', 'A string resource requires bounded text.');
    return value;
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') authoringError('SFD1822', 'A Boolean resource requires true or false.');
    return value;
  }
  if (['int', 'double'].includes(type)) return finiteNumber(value, {
    label: 'Resource value', integer: type === 'int', minimum: type === 'int' ? -2147483648 : -Number.MAX_VALUE,
    maximum: type === 'int' ? 2147483647 : Number.MAX_VALUE
  });
  if (type === XAML + 'Thickness') return normalizeProperty('Border', 'Padding', value);
  if (type === XAML + 'CornerRadius') return normalizeProperty('Border', 'CornerRadius', value);
  if (type === XAML + 'GridLength') return normalizeProperty('RowDefinition', 'Height', value);
  authoringError('SFD1822', `Resource type ${type} is not supported by the designer.`);
}

function resourceEntries(design, services) {
  if (design.resources === undefined) return;
  if (!record(design.resources) || Object.keys(design.resources).length > 500) authoringError('SFD1822', 'Resource dictionary limit.');
  for (const [key, item] of Object.entries(design.resources)) {
    resourceKey(key);
    if (Object.hasOwn(design.styles, key) || Object.hasOwn(design.templates, key)) {
      authoringError('SFD1822', `Resource key ${key} already names a style or template.`);
    }
    if (!record(item)) authoringError('SFD1822', `Resource ${key} must be an object.`);
    item.type = canonicalType(item.type);
    item.kind ??= 'value';
    if (item.kind === 'value') item.value = normalizeResourceValue(item.type, item.value, services);
    else if (item.kind === 'theme') {
      if (!record(item.variants) || !Object.hasOwn(item.variants, 'default')) {
        authoringError('SFD1822', `Theme resource ${key} requires a default value.`);
      }
      for (const [theme, value] of Object.entries(item.variants)) {
        if (!['default', 'light', 'dark', 'highContrast'].includes(theme)) authoringError('SFD1822', 'Unknown resource theme.');
        item.variants[theme] = normalizeResourceValue(item.type, value, services);
      }
    } else authoringError('SFD1822', `Resource kind ${item.kind} is unsupported.`);
  }
}

function references(design, node, services, {template = false} = {}) {
  const schema = services.propertySchema(node.type);
  for (const [property, input] of Object.entries(node.resourceReferences ?? {})) {
    const definition = schema[property];
    if (!definition || definition.readOnly || definition.isStatic) authoringError('SFD1821', `${property} cannot hold a resource reference.`);
    const reference = normalizeResourceReference(input);
    const resource = design.resources?.[reference.key];
    if (!resource) authoringError('SFD1821', `Resource ${reference.key} was not found.`);
    if (definition.type !== resource.type && definition.type !== 'object' && !frameworkAssignable(definition.type, resource.type)) {
      authoringError('SFD1821', `Resource ${reference.key} is incompatible with ${property}.`);
    }
    if (Object.hasOwn(node.properties, property) || Object.hasOwn(node.bindings ?? {}, property)) {
      authoringError('SFD1821', `${property} has more than one local value source.`);
    }
    node.resourceReferences[property] = reference;
  }
  for (const [property, input] of Object.entries(template ? {} : node.bindings ?? {})) {
    const definition = schema[property];
    if (!definition || definition.readOnly || definition.isStatic || definition.attached) {
      authoringError('SFD1820', `${property} does not support a designer binding.`);
    }
    if (Object.hasOwn(node.properties, property)) authoringError('SFD1820', `${property} has both a binding and a local value.`);
    node.bindings[property] = normalizeDesignerBinding(input);
  }
}

/** Object collection values are bounded property bags, never executable constructors or expressions. */
export function normalizeDesignerCollection(node, property, items, services) {
  boundedArray(items, 1000, property);
  const schema = services.propertySchema(node.type)[property];
  const add = frameworkManifest.members.find(member => member.owner === schema?.type && member.name === 'Add');
  if (!schema || frameworkType(schema.type)?.kind !== 'collection' || !add) {
    authoringError('SFD1823', `${property} is not an editable object collection.`);
  }
  const slot = services.childSlot(node.type);
  if (slot?.property === property && node.children?.length) {
    authoringError('SFD1823', 'Edit visual children in the outline before replacing their collection.');
  }
  return items.map(item => {
    if (!record(item)) {
      if (add.parameters[0] !== 'object' || item !== null && !['string', 'number', 'boolean'].includes(typeof item)) {
        authoringError('SFD1823', `${property} requires ${add.parameters[0]} entries.`);
      }
      if (typeof item === 'number') finiteNumber(item);
      if (typeof item === 'string' && item.length > 100000) authoringError('SFD1823', 'Collection item text limit.');
      return item;
    }
    const type = canonicalType(item.type);
    if (!frameworkType(type) || !frameworkAssignable(add.parameters[0], type)) {
      authoringError('SFD1823', `Collection entry ${type} is not assignable to ${add.parameters[0]}.`);
    }
    if (!record(item.properties) || Object.keys(item.properties).length > 128) authoringError('SFD1823', 'Invalid item properties.');
    const properties = {};
    for (const [name, value] of Object.entries(item.properties)) properties[name] = services.normalizeProperty(type, name, value);
    return {type, properties};
  });
}

function visualStates(owner, nodes, services) {
  if (owner.states === undefined) return;
  boundedArray(owner.states, 32, 'Visual state groups');
  const groups = new Set();
  for (const group of owner.states) {
    resourceKey(group.name);
    if (groups.has(group.name)) authoringError('SFD1824', 'Visual state groups must have unique names.');
    groups.add(group.name);
    boundedArray(group.states, 64, 'Visual states');
    const names = new Set();
    for (const state of group.states) {
      resourceKey(state.name);
      if (names.has(state.name)) authoringError('SFD1824', 'States in a group must have unique names.');
      names.add(state.name);
      boundedArray(state.setters, 256, 'State setters');
      const targets = new Set();
      for (const setter of state.setters) {
        const node = nodes.get(setter.target);
        if (!node) authoringError('SFD1824', `Unknown state target ${setter.target}.`);
        if (setter.property === 'Name') authoringError('SFD1824', 'A visual state cannot change a control identity.');
        const identity = setter.target + ':' + setter.property;
        if (targets.has(identity)) authoringError('SFD1824', 'A state cannot set the same property twice.');
        targets.add(identity);
        setter.value = services.normalizeProperty(node.type, setter.property, setter.value);
      }
    }
    for (const transition of boundedArray(group.transitions ?? [], 128, 'State transitions')) {
      if (transition.from && !names.has(transition.from) || transition.to && !names.has(transition.to)) {
        authoringError('SFD1824', 'Transition endpoints must name states in their group.');
      }
      transition.duration = finiteNumber(transition.duration, {label: 'Transition duration (ms)', minimum: 0, maximum: 60000});
    }
  }
}

function designTime(design, services) {
  if (design.designTime === undefined) return;
  if (!record(design.designTime) || design.designTime.version !== 1 || !record(design.designTime.nodes)) {
    authoringError('SFD1825', 'Design-time data requires version 1 and a nodes dictionary.');
  }
  const nodes = new Map(design.nodes.map(node => [node.id, node]));
  for (const [id, data] of Object.entries(design.designTime.nodes)) {
    const node = nodes.get(id);
    if (!node || !record(data)) authoringError('SFD1825', `Invalid sample-data target ${id}.`);
    for (const [name, value] of Object.entries(data.properties ?? {})) {
      data.properties[name] = services.normalizeProperty(node.type, name, value);
    }
    if (data.items !== undefined) data.items = normalizeDesignerCollection(node, 'Items', data.items, services);
    if (data.bindingValues !== undefined) {
      if (!record(data.bindingValues)) authoringError('SFD1825', 'Binding samples must be a property dictionary.');
      for (const [name, value] of Object.entries(data.bindingValues)) {
        data.bindingValues[name] = services.normalizeProperty(node.type, name, value);
      }
    }
  }
}

function projectTypes(design) {
  if (design.projectTypes === undefined) {
    if (design.nodes.some(node => node.projectType)) authoringError('SFD1826', 'Project control metadata is missing.');
    return;
  }
  boundedArray(design.projectTypes, 256, 'Project controls');
  const types = new Map();
  for (const descriptor of design.projectTypes) {
    qualifiedIdentifier(descriptor.type, 'Project control type');
    descriptor.baseType = canonicalType(descriptor.baseType);
    if (!frameworkAssignable(CONTROLS + 'Control', descriptor.baseType) || types.has(descriptor.type)) {
      authoringError('SFD1826', 'Project controls require a unique type and supported Control base.');
    }
    if (descriptor.uri !== undefined && (typeof descriptor.uri !== 'string' || descriptor.uri.length > 2048)) {
      authoringError('SFD1826', 'Project control source path limit.');
    }
    types.set(descriptor.type, descriptor);
  }
  for (const node of design.nodes) {
    if (node.projectType && types.get(node.projectType)?.baseType !== node.type) {
      authoringError('SFD1826', `Project type metadata for ${node.id} is missing or incompatible.`);
    }
  }
}

/** Called by the document validator after ordinary tree/style validation. No package model dependency. */
export function validateDesignerAuthoring(design, services) {
  resourceEntries(design, services);
  const nodes = new Map(design.nodes.map(node => [node.id, node]));
  for (const node of design.nodes) {
    references(design, node, services);
    for (const [property, items] of Object.entries(node.collections ?? {})) {
      node.collections[property] = normalizeDesignerCollection(node, property, items, services);
    }
    visualStates(node, nodes, services);
  }
  for (const template of Object.values(design.templates)) {
    const parts = new Map();
    const visit = part => {
      parts.set(part.id, part);
      references(design, part, services, {template: true});
      for (const child of part.children ?? []) visit(child);
    };
    visit(template.root);
    visualStates(template, parts, services);
  }
  designTime(design, services);
  projectTypes(design);
  return design;
}
