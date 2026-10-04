import {frameworkType, propertiesFor} from '@sharpforge/framework';
import {samePropertyValue} from './property-diagnostics.js';

const documentFeatures = Object.freeze({
  resources: 'Resource dictionaries', themeResources: 'Theme resources', visualStates: 'Visual state groups', responsive: 'Adaptive states'
});
const nodeFeatures = Object.freeze({bindings: 'Data bindings', resourceReferences: 'Resource references', states: 'Visual states'});

/** Capability failures carry navigable diagnostics and guarantee that no source/code write has begun. */
export class LiveDesignCapabilityError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map(diagnostic => diagnostic.message).join('\n'));
    this.name = 'LiveDesignCapabilityError';
    this.code = 'SFDL0010';
    this.source = 'Designer';
    this.diagnostics = diagnostics;
    this.sourceWritten = false;
    this.codeApplied = false;
  }
}

const empty = value => value == null || typeof value === 'object' && Object.keys(value).length === 0;
const equivalent = (left, right) => empty(left) && empty(right) || samePropertyValue(left, right);

function featureValue(document, feature) {
  return feature === 'responsive' ? document.responsive?.states ?? [] : document[feature];
}

function inspectTemplate(template, key, report, nodeId) {
  if (template.states?.length) report('template.states', 'Template visual states', {nodeId, resourceKey: key});
  const pending = [template.root];
  while (pending.length) {
    const part = pending.pop();
    const details = {nodeId, partId: part.id, resourceKey: key};
    for (const [field, label] of Object.entries({resourceReferences: 'Template resource references', states: 'Template visual states'})) {
      if (!empty(part[field])) report('template.' + field, label, details);
    }
    if (!empty(part.collections)) report('template.collections', 'Template collection construction', details);
    if (part.projectType) report('template.projectType', 'Project control construction inside templates', details);
    // TemplateBinding strings are supported by the existing template runtime, unlike data-binding records.
    if (Object.values(part.bindings ?? {}).some(binding => typeof binding !== 'string')) {
      report('template.bindings', 'Template data bindings', details);
    }
    pending.push(...part.children ?? []);
  }
}

function collectionChanges(previous, node, report) {
  const commands = [];
  const names = new Set([...Object.keys(previous?.collections ?? {}), ...Object.keys(node.collections ?? {})]);
  for (const property of names) {
    const before = previous?.collections?.[property] ?? [];
    const after = node.collections?.[property] ?? [];
    // A visual-child replacement owns this collection through the existing child command.
    // Emitting a separate clear would race its detach pass and erase the new children.
    if (property === 'Items' && node.children.length && !Object.hasOwn(node.collections ?? {}, property)) continue;
    const replacesChildren = property === 'Items' && Object.hasOwn(node.collections ?? {}, property) && previous?.children.length;
    if (!replacesChildren && samePropertyValue(before, after)) continue;
    const definition = propertiesFor(node.type)[property];
    if (property !== 'Items' || frameworkType(definition?.type)?.kind !== 'collection') {
      report('collection.' + property, property + ' collection changes', {nodeId: node.id, property});
      continue;
    }
    commands.push({
      op: 'collection', id: node.id, property, items: structuredClone(after),
      previous: previous?.children.length && !Object.hasOwn(previous.collections ?? {}, property) ? null : structuredClone(before)
    });
  }
  return commands;
}

/**
 * Inspect validated design deltas before producing any runtime command.
 * Unchanged authoring metadata and designTime data do not block unrelated supported edits.
 */
export function prepareLiveDesignChanges(before, after) {
  const diagnostics = [];
  const commands = [];
  const collectionOwners = new Set();
  const report = (capability, label, details = {}) => {
    if (diagnostics.length >= 500) return;
    diagnostics.push({
      code: 'SFDL0010', severity: 'error', source: 'Designer', span: null, capability,
      message: label + ' cannot be materialized by the current live runtime. The design remains staged.',
      fixHint: 'Keep these edits staged, or generate and restart in a host that supports this feature.', ...details
    });
  };
  for (const [feature, label] of Object.entries(documentFeatures)) {
    if (!equivalent(featureValue(before, feature), featureValue(after, feature))) report(feature, label);
  }
  const old = new Map(before.nodes.map(node => [node.id, node]));
  const checkedTemplates = new Set();
  for (const node of after.nodes) {
    const previous = old.get(node.id);
    for (const [field, label] of Object.entries(nodeFeatures)) {
      if (!equivalent(previous?.[field], node[field])) report(field, label, {nodeId: node.id});
    }
    if (node.projectType !== previous?.projectType) report('projectType', 'Project control construction or replacement', {nodeId: node.id});
    if (!equivalent(previous?.events, node.events)) report('events', 'Managed event handlers', {nodeId: node.id});
    commands.push(...collectionChanges(previous, node, report));
    if (Object.hasOwn(node.collections ?? {}, 'Items')) collectionOwners.add(node.id);
    const template = after.templates[node.template];
    if (template && (node.template !== previous?.template || !samePropertyValue(before.templates[node.template], template))) {
      inspectTemplate(template, node.template, report, node.id);
      checkedTemplates.add(node.template);
    }
  }
  for (const [key, template] of Object.entries(after.templates)) {
    if (!checkedTemplates.has(key) && !samePropertyValue(before.templates[key], template)) inspectTemplate(template, key, report);
  }
  if (diagnostics.length) throw new LiveDesignCapabilityError(diagnostics);
  return {commands, collectionOwners};
}
