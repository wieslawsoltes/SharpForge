import {normalizeProperty, propertySchema, resolvedProperties} from './model.js';
import {authoringError, resourceKey, samePropertyValue} from './property-diagnostics.js';
import {normalizeDesignerBinding, normalizeResourceReference} from './resource-validation.js';

/** Common property changes clear competing local sources in the same undo transaction. */
export class DesignerPropertyCommands {
  constructor(document, {canEdit = () => true} = {}) {
    this.document = document;
    this.canEdit = canEdit;
  }

  edit(label, property, ids, action, expectedRevision = this.document.revision) {
    ids ??= this.document.selection;
    if (!ids.length || ids.some(id => !this.document.node(id))) authoringError('SFD1840', 'Select existing controls to edit.');
    if (ids.some(id => !this.canEdit(id, property))) authoringError('SFD1840', `${property} is controlled by protected source code.`);
    const selected = new Set(ids);
    return this.document.change(label, design => {
      for (const node of design.nodes) if (selected.has(node.id)) action(node, design);
    }, {expectedRevision});
  }

  set(property, value, ids) {
    return this.edit('Set ' + property, property, ids, node => {
      const normalized = value === undefined ? undefined : normalizeProperty(node.type, property, value);
      delete node.bindings?.[property];
      delete node.resourceReferences?.[property];
      delete node.templatePropertyBindings?.[property];
      if (normalized === undefined) delete node.properties[property];
      else node.properties[property] = normalized;
    });
  }

  reset(property, ids) { return this.set(property, undefined, ids); }

  bind(property, binding, ids) {
    const normalized = normalizeDesignerBinding(binding);
    return this.edit('Create binding for ' + property, property, ids, node => {
      delete node.properties[property];
      delete node.resourceReferences?.[property];
      delete node.templatePropertyBindings?.[property];
      (node.bindings ??= {})[property] = structuredClone(normalized);
    });
  }

  reference(property, reference, ids) {
    const normalized = normalizeResourceReference(reference);
    return this.edit('Set resource for ' + property, property, ids, node => {
      delete node.properties[property];
      delete node.bindings?.[property];
      delete node.templatePropertyBindings?.[property];
      (node.resourceReferences ??= {})[property] = structuredClone(normalized);
    });
  }

  convertToResource(property, key, {ids = this.document.selection, theme = false} = {}) {
    resourceKey(key);
    const nodes = ids.map(id => this.document.node(id));
    if (nodes.some(node => !node)) authoringError('SFD1841', 'Resource conversion requires an existing selection.');
    if (nodes.some(node => node.bindings?.[property] || node.resourceReferences?.[property] || node.templatePropertyBindings?.[property])) {
      authoringError('SFD1841', 'Choose a concrete local value before converting a protected expression to a resource.');
    }
    const values = nodes.map(node => resolvedProperties(this.document.value, node).properties[property]);
    if (values[0] === undefined || values.some(value => !samePropertyValue(value, values[0]))) {
      authoringError('SFD1841', 'Choose a shared concrete value before converting the selection to a resource.');
    }
    return this.edit('Convert ' + property + ' to resource', property, ids, (node, design) => {
      if (!design.resources?.[key]) {
        if (design.styles[key] || design.templates[key]) authoringError('SFD1841', `Resource key ${key} already exists.`);
        const type = propertySchema(node.type)[property]?.type;
        (design.resources ??= {})[key] = theme ? {kind: 'theme', type, variants: {default: structuredClone(values[0])}} :
          {kind: 'value', type, value: structuredClone(values[0])};
      } else if (node === design.nodes.find(candidate => ids.includes(candidate.id))) {
        authoringError('SFD1841', `Resource key ${key} already exists.`);
      }
      delete node.properties[property];
      delete node.bindings?.[property];
      (node.resourceReferences ??= {})[property] = {kind: theme ? 'theme' : 'static', key};
    });
  }
}
