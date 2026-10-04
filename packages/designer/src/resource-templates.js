import {DesignDocument, normalizeProperty, propertySchema} from './model.js';
import {authoringError, resourceKey} from './property-diagnostics.js';

function flatten(part, nodes) {
  nodes.push({id: part.id, type: part.type, properties: structuredClone(part.properties ?? {}), events: {},
    children: (part.children ?? []).map(child => child.id), templatePropertyBindings: structuredClone(part.bindings ?? {}),
    resourceReferences: structuredClone(part.resourceReferences ?? {})});
  (part.children ?? []).forEach(child => flatten(child, nodes));
}

function inflate(document, id) {
  const node = document.node(id);
  return {id, type: node.type, properties: structuredClone(node.properties),
    bindings: structuredClone(node.templatePropertyBindings ?? {}), resourceReferences: structuredClone(node.resourceReferences ?? {}),
    children: node.children.map(child => inflate(document, child))};
}

/** Template editing uses an isolated visual tree and commits atomically back to its resource owner. */
export class DesignerTemplateScope {
  constructor(ownerDocument, key) {
    resourceKey(key);
    const template = ownerDocument.value.templates[key];
    if (!template) authoringError('SFD1852', `Template ${key} was not found.`);
    this.ownerDocument = ownerDocument;
    this.key = key;
    this.ownerRevision = ownerDocument.revision;
    this.closed = false;
    this.targetType = template.targetType;
    const nodes = [];
    flatten(template.root, nodes);
    if (template.states) nodes[0].states = structuredClone(template.states);
    this.document = new DesignDocument({version: 1, name: key, root: template.root.id,
      width: ownerDocument.value.width, height: ownerDocument.value.height, nodes, styles: {}, templates: {},
      resources: structuredClone(ownerDocument.value.resources ?? {})});
  }

  ensure() { if (this.closed) authoringError('SFD1852', 'Template scope has closed.'); }

  setBinding(partId, property, sourceProperty) {
    this.ensure();
    return this.document.change('Edit template binding', design => {
      const node = design.nodes.find(candidate => candidate.id === partId);
      if (!node) authoringError('SFD1852', 'Unknown template part.');
      const target = propertySchema(node.type)[property];
      const source = propertySchema(this.targetType)[sourceProperty];
      if (sourceProperty && (!target || target.readOnly || !source || target.type !== source.type && target.type !== 'object')) {
        authoringError('SFD1852', 'Template binding properties must have compatible types.');
      }
      if (!sourceProperty) delete node.templatePropertyBindings?.[property];
      else {
        delete node.properties[property];
        delete node.resourceReferences?.[property];
        (node.templatePropertyBindings ??= {})[property] = sourceProperty;
      }
    });
  }

  setProperty(partId, property, value) {
    this.ensure();
    return this.document.change('Edit template part', design => {
      const node = design.nodes.find(candidate => candidate.id === partId);
      if (!node) authoringError('SFD1852', 'Unknown template part.');
      delete node.templatePropertyBindings?.[property];
      delete node.resourceReferences?.[property];
      if (value === undefined) delete node.properties[property];
      else node.properties[property] = normalizeProperty(node.type, property, value);
    });
  }

  commit() {
    this.ensure();
    const root = inflate(this.document, this.document.value.root);
    const changed = this.ownerDocument.change('Edit template ' + this.key, design => {
      if (!design.templates[this.key]) authoringError('SFD1852', 'Template was removed while its editor was open.');
      design.templates[this.key].root = root;
      if (this.document.node(this.document.value.root).states) {
        design.templates[this.key].states = structuredClone(this.document.node(this.document.value.root).states);
      } else delete design.templates[this.key].states;
      if (Object.keys(this.document.value.resources ?? {}).length) design.resources = structuredClone(this.document.value.resources);
    }, {expectedRevision: this.ownerRevision});
    this.closed = true;
    return changed;
  }

  cancel() { this.closed = true; }
}
