import {frameworkType} from '@sharpforge/framework';
import {resolvedProperties} from './model.js';
import {designerPropertySchema} from './metadata.js';
import {samePropertyValue} from './property-diagnostics.js';
import {designerAttachedPropertyFilter} from './property-parent-context.js';

/** Value-source inspection reports expressions without invoking converters or evaluating bindings. */
export function designerPropertySource(design, node, name, resolved = resolvedProperties(design, node)) {
  if (node.templatePropertyBindings?.[name]) return {kind: 'template', value: undefined,
    expression: node.templatePropertyBindings[name], label: 'TemplateBinding: ' + node.templatePropertyBindings[name]};
  if (node.bindings?.[name]) return {kind: 'binding', value: undefined, expression: structuredClone(node.bindings[name]), label: 'Binding'};
  if (node.resourceReferences?.[name]) {
    const reference = node.resourceReferences[name];
    return {kind: 'resource', value: undefined, expression: structuredClone(reference), label: `${reference.kind} resource: ${reference.key}`};
  }
  const label = resolved.sources[name] ?? 'default';
  const kind = label === 'local' ? 'local' : label.startsWith('style:') ? 'style' :
    label.startsWith('template:') ? 'template' : 'default';
  return {kind, value: resolved.properties[name], label};
}

export function formatDesignerProperty(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  if (value.Color) return '#' + ['A', 'R', 'G', 'B'].map(key => value.Color[key].toString(16).padStart(2, '0')).join('');
  if (value.GradientStops) return `${value.GradientStops.length} gradient stops`;
  if (value.GridUnitType !== undefined) return value.GridUnitType === 0 ? 'Auto' :
    value.GridUnitType === 2 ? `${value.Value === 1 ? '' : value.Value}*` : String(value.Value);
  const fields = value.Left !== undefined ? ['Left', 'Top', 'Right', 'Bottom'] :
    value.TopLeft !== undefined ? ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] : null;
  return fields ? fields.map(key => value[key]).join(', ') : JSON.stringify(value);
}

/** O(document nodes + selected nodes × common properties), resolving inherited values once per node. */
export function designerPropertyRows(design, ids, {search = '', arrange = 'category', sourceBindings = {}} = {}) {
  const byId = new Map(design.nodes.map(node => [node.id, node]));
  const selected = ids.map(id => byId.get(id)).filter(Boolean);
  if (!selected.length) return [];
  const schemas = selected.map(node => designerPropertySchema(node.type));
  const values = selected.map(node => resolvedProperties(design, node));
  const relevant = designerAttachedPropertyFilter(design, selected, {search, sourceBindings, resolved: values});
  const needle = search.trim().toLocaleLowerCase('en-US');
  const rows = [];
  for (const [name, schema] of Object.entries(schemas[0])) {
    const collection = frameworkType(schema.type)?.kind === 'collection';
    if (schema.isStatic || schema.readOnly && !collection ||
      ['Style', 'Template', 'Child', 'Children'].includes(name) || name === 'Content' && selected.some(node => node.children.length)) continue;
    if (!schemas.every(candidate => candidate[name]?.type === schema.type)) continue;
    if (!relevant(name, schema)) continue;
    const sources = selected.map((node, index) => designerPropertySource(design, node, name, values[index]));
    const current = collection ? selected[0].collections?.[name] ?? [] : sources[0].value;
    const mixed = sources.some(source => !samePropertyValue(source.value, sources[0].value) ||
      !samePropertyValue(source.expression, sources[0].expression)) ||
      collection && selected.some(node => !samePropertyValue(node.collections?.[name] ?? [], current));
    const sameSource = sources.every(item => item.kind === sources[0].kind && item.label === sources[0].label);
    const source = sameSource ? sources[0] : {kind: 'mixed', label: 'Mixed value sources'};
    const protectedSource = selected.some(node => sourceBindings[node.id]?.properties?.[name]?.dynamic);
    const text = formatDesignerProperty(current);
    if (needle && !`${name} ${text} ${source.label}`.toLocaleLowerCase('en-US').includes(needle)) continue;
    rows.push({name, schema, category: schema.category, source, value: current, mixed, protectedSource,
      collection, text, ids: selected.map(node => node.id), type: selected[0].type});
  }
  const key = row => arrange === 'source' ? row.source.kind : arrange === 'name' ? '' : row.category;
  return rows.sort((left, right) => key(left).localeCompare(key(right), 'en') || left.name.localeCompare(right.name, 'en'));
}

/** Serializable UI state is separate from the design document and generated source. */
export class DesignerPropertyGridState {
  constructor(value = {}) {
    this.search = '';
    this.arrange = ['name', 'category', 'source'].includes(value.arrange) ? value.arrange : 'category';
    this.collapsed = {...value.collapsed};
    this.tab = 'properties';
  }

  isCollapsed(type, category) { return this.collapsed[type + ':' + category] === true; }

  setCollapsed(type, category, collapsed) { this.collapsed[type + ':' + category] = !!collapsed; }

  snapshot() { return {arrange: this.arrange, collapsed: {...this.collapsed}}; }
}
