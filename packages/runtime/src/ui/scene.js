import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {frameworkDefinition} from './object-storage.js';

const attached = new Set(['$Row', '$Column', '$RowSpan', '$ColumnSpan', '$WrapRowSpan', '$WrapColumnSpan', '$Left', '$Top', '$ZIndex']);

export function managedItemScene(platform, projection) {
  const value = {...projection, realized: projection.realized.map(record => ({...record,
    item: platform.exportValue(record.item), container: platform.exportValue(record.container)}))};
  if (projection.groups) value.groups = projection.groups.map(group => ({...group,
    group: platform.exportValue(group.group), header: platform.exportValue(group.header)}));
  if (projection.panel) value.panel = platform.exportValue(projection.panel);
  return value;
}

export function appendManagedTemplateScene(platform, reference, node, queue) {
  const root = platform.get(reference, '$templateRoot'), owner = platform.get(reference, '$templateOwner');
  const bindings = platform.get(reference, '$bindings');
  if (root) { node.templateRoot = platform.ui.id(root); queue.push(root); }
  if (owner) node.templateOwner = platform.ui.id(owner);
  if (bindings) node.templateBindings = Object.fromEntries(Object.entries(JSON.parse(platform.native(bindings)))
    .filter(([name]) => !platform.get(reference, '$local:' + name, false)));
  const layoutTemplates = platform.ui.layoutTemplates.scene(reference);
  if (layoutTemplates) node.properties.$layoutTemplates = layoutTemplates;
  const containers = platform.get(reference, '$itemContainers');
  if (containers) {
    const values = platform.ui.items(containers);
    node.collections.$itemContainers = values.map(value => platform.exportValue(value));
    queue.push(...values);
  }
  const itemIndex = platform.get(reference, '$itemIndex', null);
  if (itemIndex !== null) node.properties.$itemIndex = platform.native(itemIndex);
}

function publicProperties(platform, reference, node, queue) {
  for (const [name, value] of platform.propertyEntries(reference)) {
    if (name.startsWith('$event:')) {
      if (value && platform.heap.get(value).data.length) node.events.push(name.slice(7));
      continue;
    }
    if (name === '$drawing' && value) node.drawing = JSON.parse(platform.native(value));
    if (attached.has(name)) {
      node.properties[name.slice(1)] = platform.native(value);
      node.localProperties.push(name.slice(1));
    }
    if (name.startsWith('$') || node.properties.$items && ['Items', 'ItemsSource'].includes(name) || !isReference(value)) continue;
    const record = platform.heap.get(value);
    if (record.kind === 'collection' || frameworkType(record.type)?.kind === 'collection') {
      node.collections[name] = platform.ui.items(value).map(item => platform.exportValue(item));
    }
    queue.push(value);
  }
}

/** Snapshot traversal follows identities once and includes only registered UI records in its node budget. */
export function managedScene(platform) {
  platform.ui.flushContentPresenters?.();
  const nodes = [], seen = new Set(), queue = [...platform.windows.values()];
  const maximum = platform.options.maxUISceneNodes ?? 100000;
  for (let index = 0; index < queue.length; index++) {
    const reference = queue[index];
    if (!isReference(reference)) continue;
    const id = platform.ui.id(reference);
    if (seen.has(id)) continue;
    seen.add(id);
    const record = platform.heap.get(reference);
    if (record.kind === 'string' || record.kind === 'delegate' || record.kind === 'array') continue;
    if (record.kind === 'box') {
      if (isReference(record.data[0])) queue.push(record.data[0]);
      continue;
    }
    if (record.kind === 'collection' || frameworkType(record.type)?.kind === 'collection') {
      for (const value of platform.ui.items(reference)) if (isReference(value)) queue.push(value);
      continue;
    }
    const definition = frameworkDefinition(platform, record.type);
    if (!definition) continue;
    if (nodes.length >= maximum) throw new ManagedFault('ExecutionLimitException', 'UI scene limit');
    const localProperties = platform.propertyEntries(reference).filter(([name, value]) => name.startsWith('$local:') && value)
      .map(([name]) => name.slice(7));
    const node = {id, type: definition.name, managedType: record.type, properties: platform.exportProperties(reference),
      localProperties, events: [], collections: {}};
    const items = platform.ui.itemScene?.(reference);
    if (items) {
      node.properties.$items = managedItemScene(platform, items);
      delete node.properties.Items;
      delete node.properties.ItemsSource;
      for (const group of items.groups ?? []) if (group.header) queue.push(group.header);
      if (items.panel) queue.push(items.panel);
    }
    appendManagedTemplateScene(platform, reference, node, queue);
    publicProperties(platform, reference, node, queue);
    nodes.push(node);
  }
  return {version: 1, windows: [...platform.windows.keys()], nodes};
}
