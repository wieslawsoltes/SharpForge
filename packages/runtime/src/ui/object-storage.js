import {frameworkType, propertiesFor, XAML} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {initializeRenderingBase, materializeRenderingModelDefaults} from '@sharpforge/rendering';

const hostKinds = new Set(['host', 'delegate', 'collection', 'task', 'thread']);

/** Find the first registered base while preserving the actual managed method-table identity. */
export function frameworkDefinition(platform, type) {
  const seen = new Set();
  let table = platform.heap.methodTables.get(type);
  while (table && seen.size < 256 && !seen.has(table)) {
    const definition = frameworkType(table.name);
    if (definition) return definition;
    seen.add(table);
    table = table.base;
  }
  return null;
}

export function managedUIProperties(platform, type) {
  const definition = frameworkDefinition(platform, type);
  return definition ? propertiesFor(definition.name) : {};
}

/** A hidden tail reference owns UI state without replacing or renumbering managed instance fields. */
export function uiObjectStorage(platform, reference, {allowObject = false} = {}) {
  const record = platform.heap.get(reference);
  if (hostKinds.has(record.kind)) return {record, reference};
  const definition = record.kind === 'object' ? frameworkDefinition(platform, record.type) : null;
  if (record.kind !== 'object' || !allowObject && (!definition || !definition.name.startsWith(XAML))) {
    throw new ManagedFault('InvalidCastException', 'A managed framework object is required');
  }
  const index = record.uiStateIndex ?? record.methodTable.fields.length;
  const previous = record.data[index];
  if (isReference(previous)) {
    const entry = platform.heap.get(previous);
    if (entry.kind === 'host' && entry.type === record.type) return {record: entry, reference: previous};
  }
  return platform.heap.withRoots([reference], () => {
    const data = [];
    for (const [name, property] of Object.entries(definition ? propertiesFor(definition.name) : {})) {
      if (property.isStatic || property.value === null) continue;
      const value = platform.managed(property.value, property.type);
      platform.heap.pins.push(value);
      data.push(name, value);
    }
    const storage = platform.make(record.type, Object.fromEntries(Array.from({length: data.length / 2},
      (_, i) => [data[i * 2], data[i * 2 + 1]])));
    platform.heap.pins.push(storage);
    const fields = record.data.slice(0, index);
    fields.push(storage);
    platform.heap.replaceData(reference, fields);
    record.uiStateIndex = index;
    return {record: platform.heap.get(storage), reference: storage};
  });
}

/** Base construction initializes the existing derived receiver; it never manufactures a second control identity. */
export function initializeFrameworkBase(context, receiver, owner, args = []) {
  const platform = context.platform;
  const definition = frameworkType(owner);
  if (!definition || !context.properties.assignable(owner, context.typeOf(receiver))) {
    throw new ManagedFault('InvalidCastException', 'Framework base constructor owner is incompatible with its receiver');
  }
  if (context.services.automation?.initializePeer(receiver, owner, args)) return;
  const rendering = initializeRenderingBase(context, receiver, owner, args);
  if (rendering) {
    context.modelReferences.set(rendering, receiver);
    materializeRenderingModelDefaults(context, receiver, (name, value) => context.properties.initializeDefault(receiver, name, value));
    context.modelState.sync(receiver);
  } else if (args.length) {
    throw new ManagedFault('NotSupportedException', 'This WinUI subclass profile requires a parameterless framework base constructor');
  }
  uiObjectStorage(platform, receiver);
  if (owner === XAML + 'Application') {
    if (platform.application && context.id(platform.application) !== context.id(receiver)) {
      throw new ManagedFault('InvalidOperationException', 'An application already exists');
    }
    platform.application = receiver;
  }
  if (!platform.get(receiver, '$uiInitialized', false)) {
    platform.set(receiver, '$uiInitialized', true);
    platform.command({op: 'create', id: context.id(receiver), type: frameworkDefinition(platform, context.typeOf(receiver)).name,
      managedType: context.typeOf(receiver), properties: platform.exportProperties(receiver)});
  }
}
