import {canonicalType} from '@sharpforge/framework';
import {childSlot, normalizeProperty, propertySchema} from './model.js';
import {normalizeDesignerCollection} from './resource-validation.js';
import {DesignSyncError, failSource} from './source-errors.js';
import {sourceSpanLookup} from './source-spans.js';

const services = Object.freeze({childSlot, normalizeProperty, propertySchema});
const covers = (statement, reference) => statement.uri === reference.uri
  && statement.start <= reference.start && statement.end >= reference.end;

function collectionFor(binding, property) {
  binding.collections ??= {};
  return binding.collections[property] ??= {entries: [], dynamic: false, reason: null};
}

function protect(reader, binding, property, collection, message, region = null) {
  collection.dynamic = true;
  collection.reason ??= message;
  if (region) protectRegion(region);
  if (collection.reported) return;
  collection.reported = true;
  const first = collection.entries[0];
  const expression = first?.expression ?? binding.creation;
  binding.properties[property] ??= {expression, statement: first?.statement ?? binding.statement, dynamic: true};
  reader.warnings.push({code: 'SFSYNC_DYNAMIC', node: binding.id, property,
    message: `${property} is read-only: ${message}`, uri: expression.uri, start: expression.start, end: expression.end});
}

function protectRegion(region) {
  region.kind = 'protected';
  region.capabilities = ['navigate'];
  for (const expression of region.expressions) expression.capability = 'navigate';
}

export function unownedCollectionReference(binding, method, handwritten) {
  return binding.references.find(reference => !reference.declaration && (handwritten(reference)
    || reference.uri !== method.uri || reference.start < method.body.start || reference.end > method.body.end));
}

function inlineItem(reader, expression) {
  if (expression.args.length) failSource('Collection object constructors must be parameterless', expression, 'SFSYNC_DYNAMIC');
  const symbol = reader.context.model.getTypeInfo(expression).type;
  const type = canonicalType(symbol?.legacy?.fullName ?? expression.type);
  const properties = {};
  for (const initializer of expression.initializers ?? []) properties[initializer.name] = reader.readValue(initializer.expression);
  if (expression.collectionInitializers?.length) failSource('Nested collection items are protected', expression, 'SFSYNC_DYNAMIC');
  return {type, properties};
}

/** Reads closed Items.Add values; named object ownership is resolved once all method statements are known. */
export function readSourceCollection(reader, binding, property, expression, statement) {
  if (property !== 'Items' || !propertySchema(reader.nodeMap.get(binding.id).type)[property]) return false;
  const collection = collectionFor(binding, property);
  if (collection.entries.length >= 1000) failSource('A designer Items collection supports at most 1000 entries', expression, 'SFSYNC_LIMIT');
  const entry = {expression, statement, region: reader.region, dependencies: []};
  collection.entries.push(entry);
  reader.own(binding.id, expression, 'collection');
  try {
    const known = reader.lookup(expression);
    if (known?.node) entry.itemId = known.node;
    else {
      const value = expression.kind === 'New' ? inlineItem(reader, expression) : reader.readValue(expression);
      entry.value = normalizeDesignerCollection(reader.nodeMap.get(binding.id), property, [value], services)[0];
    }
  } catch (error) {
    if (!(error instanceof DesignSyncError || error instanceof TypeError)) throw error;
    if (error.code === 'SFSYNC_LIMIT') throw error;
    protect(reader, binding, property, collection, error.message, reader.region);
  }
  return true;
}

/** Unknown Items operations remain source-owned and disable collection editing without blocking scalar edits. */
export function protectSourceCollectionCall(reader, expression, statement) {
  const access = expression.target?.target;
  if (access?.kind !== 'Member' || access.name !== 'Items') return false;
  const parent = reader.lookup(access.target);
  if (!parent?.node) return false;
  const binding = reader.bindings[parent.node];
  const collection = collectionFor(binding, 'Items');
  if (collection.entries.length >= 1000) failSource('A designer Items collection supports at most 1000 entries', expression, 'SFSYNC_LIMIT');
  collection.entries.push({expression, statement, region: reader.region, dependencies: []});
  protect(reader, binding, 'Items', collection, 'Only closed Add statements can be edited.', reader.region);
  reader.own(binding.id, expression, 'navigate');
  return true;
}

function namedItem(reader, entry, occurrences) {
  const item = reader.nodeMap.get(entry.itemId);
  const binding = reader.bindings[entry.itemId];
  if (!item || !binding || binding.field || binding.inline || binding.statement.declarations?.length !== 1) {
    failSource('Collection objects require an exclusively owned local declaration', entry.expression, 'SFSYNC_OWNERSHIP');
  }
  if (occurrences.get(item.id) !== 1 || item.children.length || Object.keys(item.events).length || item.style || item.template
    || item.projectType || item.states?.length || binding.creation.args.length || Object.keys(binding.collections ?? {}).length) {
    failSource('Shared or nested collection objects are preserved in C#', entry.expression, 'SFSYNC_OWNERSHIP');
  }
  const statements = [binding.statement];
  for (const property of Object.values(binding.properties)) {
    if (property.dynamic) failSource('A collection object has a protected property', property.expression, 'SFSYNC_DYNAMIC');
    statements.push(...[...(property.previous ?? []), property].map(value => value.statement));
  }
  if (binding.references.some(reference => !reference.declaration
    && ![...statements, entry.statement].some(statement => covers(statement, reference)))) {
    failSource('A collection object is referenced by handwritten C#', entry.expression, 'SFSYNC_REFERENCE');
  }
  entry.dependencies = [...new Map(statements.map(statement => [statement.uri + ':' + statement.start, statement])).values()];
  return {type: item.type, properties: structuredClone(item.properties)};
}

function retainVisualChildren(reader, binding, property, collection, occurrences) {
  if (collection.dynamic || !collection.entries.length || childSlot(reader.nodeMap.get(binding.id).type)?.property !== property) return false;
  const items = collection.entries.map(entry => reader.nodeMap.get(entry.itemId));
  if (items.some(item => !item || occurrences.get(item.id) !== 1)) return false;
  if (!items.some(item => reader.bindings[item.id].field || item.children.length || Object.keys(item.events).length || item.style || item.template)) {
    return false;
  }
  const parent = reader.nodeMap.get(binding.id);
  for (const entry of collection.entries) {
    parent.children.push(entry.itemId);
    binding.edges.push({statement: entry.statement, expression: entry.expression, key: property, child: entry.itemId});
    if (!entry.region.owners.includes(entry.itemId)) entry.region.owners.push(entry.itemId);
  }
  delete binding.collections[property];
  return true;
}

/** Projects exclusive collection object locals into value records, retaining source spans for transactional edits. */
export function finishSourceCollections(reader) {
  const handwritten = sourceSpanLookup(reader.unmanaged.map(item => item.statement), reader.context.chosen.parsed.source.uri);
  const occurrences = new Map();
  for (const binding of Object.values(reader.bindings)) {
    for (const collection of Object.values(binding.collections ?? {})) {
      for (const entry of collection.entries) if (entry.itemId) occurrences.set(entry.itemId, (occurrences.get(entry.itemId) ?? 0) + 1);
    }
  }
  const absorbed = new Map();
  for (const binding of Object.values(reader.bindings)) {
    const node = reader.nodeMap.get(binding.id);
    for (const [property, collection] of Object.entries(binding.collections ?? {})) {
      if (retainVisualChildren(reader, binding, property, collection, occurrences)) continue;
      try {
        for (const entry of collection.entries) {
          if (entry.itemId) entry.value = namedItem(reader, entry, occurrences);
        }
        const unknownUse = unownedCollectionReference(binding, reader.context.chosen.method, handwritten);
        if (unknownUse) failSource('Custom statements reference this collection owner', unknownUse, 'SFSYNC_OWNERSHIP');
        if (!collection.dynamic) {
          const values = collection.entries.map(entry => entry.value);
          (node.collections ??= {})[property] = normalizeDesignerCollection(node, property, values, services);
          for (const entry of collection.entries) if (entry.itemId) absorbed.set(entry.itemId, binding.id);
        }
      } catch (error) {
        if (!(error instanceof DesignSyncError || error instanceof TypeError)) throw error;
        protect(reader, binding, property, collection, error.message);
      }
      if (collection.dynamic) {
        for (const entry of collection.entries) protectRegion(entry.region);
        const previous = reader.previousNodes.get(node.id);
        if (previous?.type === node.type && previous.collections?.[property]) {
          (node.collections ??= {})[property] = structuredClone(previous.collections[property]);
        }
      }
    }
  }
  if (!absorbed.size) return;
  reader.nodes = reader.nodes.filter(node => !absorbed.has(node.id));
  for (const id of absorbed.keys()) {
    reader.nodeMap.delete(id);
    delete reader.bindings[id];
  }
  for (const region of reader.regions) {
    region.owners = [...new Set(region.owners.map(id => absorbed.get(id) ?? id))];
    for (const expression of region.expressions) expression.owner = absorbed.get(expression.owner) ?? expression.owner;
  }
}
