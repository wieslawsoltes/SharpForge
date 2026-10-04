import { frameworkType } from '@sharpforge/framework';
import { isReference, ManagedFault } from '../heap.js';
import { frameworkDefinition } from './object-storage.js';
import { prepareManagedVisuals } from './tree-services.js';
import { appendManagedTemplateScene } from './scene.js';

export function layoutReference(context, value) {
  if (value == null) return null;
  if (isReference(value)) { context.platform.heap.get(value); return value; }
  const id = typeof value === 'string' ? value : value.$ref ?? value.id;
  if (typeof id !== 'string' || !/^\d+:\d+$/.test(id)) throw new ManagedFault('ArgumentException', 'Invalid managed layout identity');
  const [h, g] = id.split(':').map(Number);
  if (!Number.isSafeInteger(h) || !Number.isSafeInteger(g)) throw new ManagedFault('ArgumentException', 'Invalid managed layout identity');
  const reference = { h, g };
  context.platform.heap.get(reference);
  return reference;
}

/** Active scenes are extended with explicitly measured, not-yet-attached elements. No heap-wide scan is needed. */
export function collectManagedLayoutScene(context, receiver = null) {
  const platform = context.platform;
  if (receiver != null) prepareManagedVisuals(context, layoutReference(context, receiver));
  const scene = platform.scene();
  const records = new Map(scene.nodes.map(node => [node.id, node]));
  const queue = receiver == null ? [] : [layoutReference(context, receiver)];
  const seen = new Set();
  for (let index = 0; index < queue.length; index++) {
    const reference = queue[index];
    if (!isReference(reference)) continue;
    const id = context.id(reference);
    if (seen.has(id)) continue;
    if (seen.size >= 20000) throw new ManagedFault('ExecutionLimitException', 'Managed layout scene limit');
    seen.add(id);
    const record = platform.heap.get(reference);
    if (record.kind === 'string' || record.kind === 'delegate') continue;
    if (record.kind === 'box') { if (isReference(record.data[0])) queue.push(record.data[0]); continue; }
    if (record.kind === 'collection' || record.kind === 'array') {
      queue.push(...context.items(reference).filter(isReference));
      continue;
    }
    const definition = frameworkDefinition(platform, record.type);
    if (!definition) continue;
    const node = records.get(id) ?? { id, type: definition.name, managedType: record.type,
      properties: platform.exportProperties(reference), collections: {}, events: [] };
    appendEdges(context, reference, node, queue);
    records.set(id, node);
  }
  return { version: 1, windows: [...scene.windows], nodes: [...records.values()] };
}

function appendEdges(context, reference, node, queue) {
  const platform = context.platform;
  appendManagedTemplateScene(platform, reference, node, queue);
  for (const [name, value] of platform.propertyEntries(reference)) {
    if (['$Row', '$Column', '$RowSpan', '$ColumnSpan', '$WrapRowSpan', '$WrapColumnSpan', '$Left', '$Top', '$ZIndex'].includes(name)) {
      node.properties[name.slice(1)] = context.native(value);
    }
    if (name.startsWith('$') || !isReference(value)) continue;
    const record = platform.heap.get(value);
    if (record.kind === 'collection') node.collections[name] = context.items(value).map(item => platform.exportValue(item));
    queue.push(value);
  }
}

function sameValue(left, right, depth = 0) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || depth >= 16) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key], depth + 1));
}

/** Reuse records whose effective layout data did not change, preserving engine measure caches. */
export function reconcileManagedLayoutScene(context, scene, nodes, registerOverride) {
  const retained = new Set();
  for (const source of scene.nodes) {
    const node = { ...source, type: source.managedType ?? source.type, frameworkType: source.type };
    retained.add(node.id);
    const previous = nodes.get(node.id);
    if (!previous || !sameValue(previous, node)) nodes.set(node.id, node);
    if (node.type !== node.frameworkType && !frameworkType(node.type)) registerOverride(node.type, node.frameworkType);
  }
  for (const id of nodes.keys()) if (!retained.has(id)) nodes.delete(id);
}
