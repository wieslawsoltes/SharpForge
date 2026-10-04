import {owned} from './composition-target.js';
import {validatePropertyValue} from './property-set.js';
import {validateEffectGraph, effectSourceNames} from './effects.js';

export function sameCompositionValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || left.Compositor || right.Compositor) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every(name =>
    Object.hasOwn(right, name) && sameCompositionValue(left[name], right[name]));
}

function referenceIds(value, output, depth = 0) {
  if (depth > 64) throw new RangeError('Composition graph reference depth exceeded');
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if (Object.hasOwn(value, '$composition')) { output.push(value.$composition); return; }
  for (const item of Object.values(value)) referenceIds(item, output, depth + 1);
}

/** Validate all resource and collection edges before any live graph mutation. */
export function validateGraphReferences(rows, roots) {
  const edges = new Map();
  const parents = new Set();
  const propertyOwners = new Set();
  for (const row of rows.values()) {
    for (const name of ['children', 'shapes', 'stops', 'sources', 'entries', 'dashes']) {
      if (row[name] != null && (!Array.isArray(row[name]) || row[name].length > 10000)) throw new TypeError('Invalid graph collection');
    }
    if (row.properties != null) {
      if (rows.get(row.properties)?.kind !== 'CompositionPropertySet') throw new TypeError('Invalid Properties reference');
      if (row.kind !== 'CompositionPropertySet') {
        if (propertyOwners.has(row.properties)) throw new TypeError('A Properties set cannot have multiple owners');
        propertyOwners.add(row.properties);
      } else if (row.properties !== row.id) throw new TypeError('A property set must reference itself');
    }
    const references = [...(row.children ?? []), ...(row.shapes ?? []), ...(row.stops ?? [])];
    for (const source of row.sources ?? []) {
      if (!Array.isArray(source) || source.length !== 2) throw new TypeError('Invalid effect source entry');
      const [name, id] = source;
      if (typeof name !== 'string' || name.length > 128) throw new TypeError('Invalid effect source name');
      references.push(id);
    }
    referenceIds(row.values, references);
    for (const child of row.children ?? []) {
      if (parents.has(child)) throw new TypeError('A transported visual cannot have multiple parents');
      parents.add(child);
    }
    edges.set(row.id, references);
  }
  const visited = new Set();
  const active = new Set();
  const visit = (id, depth) => {
    if (!rows.has(id) || depth > 256 || active.has(id)) throw new TypeError('Invalid or cyclic transported composition graph');
    if (visited.has(id)) return;
    active.add(id);
    for (const child of edges.get(id)) visit(child, depth + 1);
    active.delete(id);
    visited.add(id);
  };
  for (const id of rows.keys()) visit(id, 0);
  for (const id of roots) {
    if (!rows.get(id)?.kind.endsWith('Visual') || parents.has(id)) throw new TypeError('Invalid transported composition root');
  }
}

function prepareEntries(row, object, objects, decode) {
  if (row.entries && object.kind !== 'CompositionPropertySet') throw new TypeError('Only property sets can contain typed entries');
  const entries = (row.entries ?? []).map(entry => {
    if (!Array.isArray(entry) || entry.length !== 3) throw new TypeError('Invalid property set entry');
    const [name, kind, value] = entry;
    if (object.values?.has(name) && object.values.get(name).kind !== kind) throw new TypeError('A composition property cannot change its type');
    return [name, kind, validatePropertyValue(name, kind, decode(value, objects))];
  });
  if (entries.length > 256 || new Set(entries.map(entry => entry[0])).size !== entries.length) {
    throw new RangeError('Invalid transported property set entries');
  }
  return entries;
}

function prepareSources(row, object, objects) {
  if (object.kind !== 'CompositionEffectBrush') {
    if (row.graph || row.sources) throw new TypeError('Only effect brushes can contain effect graphs or sources');
    return null;
  }
  const graph = validateEffectGraph(row.graph);
  const names = effectSourceNames(graph);
  const sources = new Map();
  for (const [name, id] of row.sources ?? []) {
    const source = objects.get(id);
    if (!names.has(name) || sources.has(name) || !source?.kind.endsWith('Brush')) throw new TypeError('Invalid effect source binding');
    owned(source, object, value => value.kind.endsWith('Brush'));
    sources.set(name, source);
  }
  return {graph, sources};
}

export function prepareGraphChanges(rows, objects, decode) {
  const changes = [];
  for (const row of rows.values()) {
    const object = objects.get(row.id);
    const values = object.kind === 'CompositionPropertySet' ? {} : decode(row.values, objects);
    if (!values || Array.isArray(values) || typeof values !== 'object') throw new TypeError('Invalid composition property values');
    for (const [name, value] of Object.entries(values)) object.validate(name, value);
    const entries = prepareEntries(row, object, objects, decode);
    const effect = prepareSources(row, object, objects);
    if (row.dashes && (!object.StrokeDashArray || row.dashes.length > 256
      || row.dashes.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0))) {
      throw new TypeError('Invalid transported stroke dash array');
    }
    const collections = [];
    for (const [field, collection, suffix] of [['children', 'Children', 'Visual'], ['shapes', 'Shapes', 'Shape'],
      ['stops', 'ColorStops', 'GradientStop']]) {
      if (row[field] === null || row[field] === undefined) continue;
      const maximum = collection === 'ColorStops' ? 4096 : object.Compositor.maxVisuals;
      if (!object[collection] || row[field].length > maximum) throw new TypeError('Invalid composition collection');
      if (collection === 'Children' && new Set(row[field]).size !== row[field].length) throw new TypeError('Duplicate visual child');
      const next = row[field].map(id => owned(objects.get(id), object, child => child.kind.endsWith(suffix)));
      if (next.includes(null)) throw new TypeError('Null composition collection entry');
      collections.push({name: collection, next, changed: !sameCompositionValue(object[collection].items, next)});
    }
    if (row.properties && objects.get(row.properties)?.kind !== 'CompositionPropertySet') throw new TypeError('Invalid Properties reference');
    changes.push({row, object, values, entries, collections, effect});
  }
  return changes;
}

export function commitGraphChanges(changes, objects) {
  for (const change of changes) {
    const collection = change.collections.find(entry => entry.name === 'Children');
    if (collection?.changed) change.object.Children.RemoveAll();
  }
  for (const {row, object, values, entries, collections, effect} of changes) {
    for (const [name, value] of Object.entries(values)) {
      if (!sameCompositionValue(object.baseValues[name], value)) object.set(name, value);
    }
    if (row.properties && object.Properties !== objects.get(row.properties)) {
      if (object.Properties !== object) object.Properties?.dispose();
      object.Properties = objects.get(row.properties);
    }
    if (row.entries) {
      const names = new Set(entries.map(entry => entry[0]));
      for (const name of object.values.keys()) if (!names.has(name)) object.remove(name);
      for (const [name, kind, value] of entries) {
        if (!object.values.has(name) || !sameCompositionValue(object.baseValues[name], value)) object.insert(name, kind, value);
      }
    }
    if (row.dashes && !sameCompositionValue(object.StrokeDashArray.items, row.dashes)) object.StrokeDashArray.ReplaceAll(row.dashes);
    for (const {name, next, changed} of collections) {
      if (!changed) continue;
      if (name !== 'Children') object[name].Clear();
      for (const value of next) object[name][name === 'Children' ? 'InsertAtTop' : 'Add'](value);
    }
    if (effect) {
      if (!sameCompositionValue(object.graph, effect.graph)) { object.graph = effect.graph; object.changed('Graph'); }
      for (const name of object.sources.keys()) if (!effect.sources.has(name)) object.SetSourceParameter(name, null);
      for (const [name, source] of effect.sources) {
        if (object.sources.get(name) !== source) object.SetSourceParameter(name, source);
      }
    }
  }
}
