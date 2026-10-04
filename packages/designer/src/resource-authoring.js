import {canonicalType, frameworkAssignable} from '@sharpforge/framework';
import {normalizeProperty, propertySchema} from './model.js';
import {authoringError, resourceKey, samePropertyValue} from './property-diagnostics.js';

function freeKey(design, key) {
  resourceKey(key);
  if (design.styles[key] || design.templates[key] || design.resources?.[key]) authoringError('SFD1850', `Resource ${key} already exists.`);
}

function selectedNodes(document, ids) {
  const nodes = ids.map(id => document.node(id));
  if (!nodes.length || nodes.some(node => !node)) authoringError('SFD1850', 'Select existing controls before authoring a style.');
  return nodes;
}

function copySetters(nodes, targetType, properties) {
  const result = {};
  for (const property of properties) {
    const values = nodes.map(node => node.properties[property]);
    if (values[0] === undefined || !values.every(value => samePropertyValue(value, values[0]))) {
      authoringError('SFD1850', `Selected controls need the same local ${property} value.`);
    }
    result[property] = normalizeProperty(targetType, property, values[0]);
  }
  return result;
}

/** Style extraction, application and copying preserve target compatibility and one-step undo. */
export class DesignerStyleCommands {
  constructor(document) { this.document = document; }

  createFromSelection(key, {ids = this.document.selection, properties, targetType, implicit = false, basedOn} = {}) {
    const nodes = selectedNodes(this.document, ids);
    targetType = canonicalType(targetType ?? nodes[0].type);
    if (nodes.some(node => !frameworkAssignable(targetType, node.type) || !propertySchema(node.type).Style)) {
      authoringError('SFD1850', 'The style target is incompatible with the selection.');
    }
    properties ??= Object.keys(nodes[0].properties).filter(name => name !== 'Name');
    const setters = copySetters(nodes, targetType, properties);
    return this.document.change('Create style ' + key, design => {
      freeKey(design, key);
      design.styles[key] = {targetType, setters, implicit};
      if (basedOn) design.styles[key].basedOn = basedOn;
      for (const node of design.nodes) {
        if (!ids.includes(node.id)) continue;
        for (const property of properties) delete node.properties[property];
        node.style = key;
      }
    });
  }

  apply(key, ids = this.document.selection) { return this.document.setReference('style', key, ids); }

  editCopy(sourceKey, key, {ids = this.document.selection} = {}) {
    const source = this.document.value.styles[sourceKey];
    if (!source) authoringError('SFD1850', `Style ${sourceKey} was not found.`);
    return this.document.change('Edit a copy of ' + sourceKey, design => {
      freeKey(design, key);
      design.styles[key] = structuredClone(source);
      for (const node of design.nodes) if (ids.includes(node.id)) node.style = key;
    });
  }

  convertLocalValues(key, properties, ids = this.document.selection) {
    const style = this.document.value.styles[key];
    if (!style) authoringError('SFD1850', `Style ${key} was not found.`);
    const nodes = selectedNodes(this.document, ids);
    if (nodes.some(node => !frameworkAssignable(style.targetType, node.type))) authoringError('SFD1850', 'Incompatible style target.');
    const setters = copySetters(nodes, style.targetType, properties);
    return this.document.change('Move local values into ' + key, design => {
      Object.assign(design.styles[key].setters, setters);
      for (const node of design.nodes) {
        if (!ids.includes(node.id)) continue;
        properties.forEach(property => delete node.properties[property]);
        node.style = key;
      }
    });
  }

  setSetter(key, property, value) {
    return this.document.change('Edit style setter', design => {
      const style = design.styles[key];
      if (!style) authoringError('SFD1850', 'Style no longer exists.');
      if (value === undefined) delete style.setters[property];
      else style.setters[property] = normalizeProperty(style.targetType, property, value);
    });
  }
}

function allResourceOwners(design) {
  const owners = [...design.nodes];
  const visit = part => {
    owners.push(part);
    for (const child of part.children ?? []) visit(child);
  };
  Object.values(design.templates).forEach(template => visit(template.root));
  return owners;
}

export function renameDesignerResource(document, key, nextKey) {
  resourceKey(key);
  return document.change('Rename resource ' + key, design => {
    freeKey(design, nextKey);
    const table = design.styles[key] ? design.styles : design.templates[key] ? design.templates : design.resources;
    if (!table?.[key]) authoringError('SFD1851', `Resource ${key} was not found.`);
    table[nextKey] = table[key];
    delete table[key];
    for (const style of Object.values(design.styles)) if (style.basedOn === key) style.basedOn = nextKey;
    for (const node of allResourceOwners(design)) {
      if (node.style === key) node.style = nextKey;
      if (node.template === key) node.template = nextKey;
      for (const reference of Object.values(node.resourceReferences ?? {})) if (reference.key === key) reference.key = nextKey;
      for (const binding of Object.values(node.bindings ?? {})) {
        if (binding && typeof binding === 'object' && binding.converter === key) binding.converter = nextKey;
      }
    }
  });
}

export function designerResourceEntries(design) {
  return [
    ...Object.entries(design.resources ?? {}).map(([key, value]) => ({key, kind: value.kind === 'theme' ? 'theme' : 'brush', value})),
    ...Object.entries(design.styles).map(([key, value]) => ({key, kind: 'style', value})),
    ...Object.entries(design.templates).map(([key, value]) => ({key, kind: 'template', value}))
  ].sort((left, right) => left.key.localeCompare(right.key, 'en'));
}

