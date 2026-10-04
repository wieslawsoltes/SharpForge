import {frameworkType} from '@sharpforge/framework';
import {isReference, ManagedFault} from './heap.js';
import {attachedStorageName, hasAttachedLocalValue} from './dependency-properties.js';

const identity = reference => `${reference.h}:${reference.g}`;

function exportNode(platform, reference, queue) {
  const record = platform.heap.get(reference);
  const entries = platform.propertyEntries(reference);
  const localProperties = new Set(entries.filter(([name, value]) => name.startsWith('$local:') && platform.native(value))
    .map(([name]) => name.slice(7)));
  const node = {id: identity(reference), type: record.type, properties: platform.exportProperties(reference),
    localProperties: [], events: [], collections: {}};
  const templateRoot = platform.get(reference, '$templateRoot');
  const templateOwner = platform.get(reference, '$templateOwner');
  const bindings = platform.get(reference, '$bindings');
  if (templateRoot) {
    node.templateRoot = identity(templateRoot);
    queue.push(templateRoot);
  }
  if (templateOwner) node.templateOwner = identity(templateOwner);
  if (bindings) {
    node.templateBindings = Object.fromEntries(Object.entries(JSON.parse(platform.native(bindings)))
      .filter(([name]) => !platform.get(reference, '$local:' + name, false)));
  }
  for (const [name, value] of entries) {
    if (name.startsWith('$event:')) {
      if (value && platform.heap.get(value).data.length) node.events.push(name.slice(7));
      continue;
    }
    if (name === '$drawing' && value) node.drawing = JSON.parse(platform.native(value));
    const attached = attachedStorageName(name);
    if (attached) {
      node.properties[attached] = platform.native(value);
      if (hasAttachedLocalValue(platform, reference, attached)) localProperties.add(attached);
    }
    if (name.startsWith('$') || !isReference(value)) continue;
    if (platform.heap.get(value).kind === 'collection') {
      node.collections[name] = platform.items(value).map(item => platform.exportValue(item));
    }
    queue.push(value);
  }
  node.localProperties = [...localProperties];
  return node;
}

/** Export each reachable object once; cleared attached defaults are values, never authored locals. */
export function exportPlatformScene(platform) {
  const nodes = [];
  const seen = new Set();
  const queue = [...platform.windows.values()];
  let offset = 0;
  while (offset < queue.length) {
    const reference = queue[offset++];
    if (!isReference(reference)) continue;
    const id = identity(reference);
    if (seen.has(id)) continue;
    seen.add(id);
    if (seen.size > 10000) throw new ManagedFault('ExecutionLimitException', 'UI scene limit');
    const record = platform.heap.get(reference);
    if (record.kind === 'string' || record.kind === 'delegate') continue;
    if (record.kind === 'box') {
      if (isReference(record.data[0])) queue.push(record.data[0]);
      continue;
    }
    if (record.kind === 'collection') {
      for (const item of platform.items(reference)) if (isReference(item)) queue.push(item);
      continue;
    }
    if (frameworkType(record.type)) nodes.push(exportNode(platform, reference, queue));
  }
  return {version: 1, windows: [...platform.windows.keys()], nodes};
}
