import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {validateReferenceLayout} from './reference-layout.js';
import {hasManagedStateMachineLayout} from './managed-state-machine-layout.js';

// Layouts contain metadata only. A code epoch, assembly or registry replacement drops them.
const caches = new WeakMap();
const memoryShapes = new WeakMap();
const packingSizes = new Set([1, 2, 4, 8, 16, 32, 64, 128]);
const maxLayoutFields = 65_536;
const maxLayoutRows = 262_144;
const align = (size, alignment) => Math.ceil(size / alignment) * alignment;
const invalid = message => { throw new ManagedFault('TypeLoadException', message); };
const unsupported = name => {
  throw new ManagedFault('NotSupportedException', 'Managed layout is not implemented: ' + name);
};

function plan(size, alignment, containsReferences, offsets = [], memory = null) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 0x7fffffff) invalid('Value layout exceeds the supported byte range');
  const result = Object.freeze({size, alignment, containsReferences, offsets: Object.freeze(offsets)});
  const shape = memory ?? {references: containsReferences ? [0] : [], scalars: containsReferences ? [] : [[0, size]]};
  memoryShapes.set(result, Object.freeze({references: Object.freeze(shape.references), scalars: Object.freeze(shape.scalars)}));
  return result;
}

function cacheFor(vm) {
  const state = executionCodeState(vm);
  let cache = caches.get(state);
  if (!cache) {
    const rows = vm.inspector?.metadata.rows;
    const classes = rows?.[15] ?? [];
    const fields = rows?.[16] ?? [];
    if (classes.length + fields.length > maxLayoutRows) unsupported('layout metadata row budget exceeded');
    cache = {plans: new WeakMap(), managedPlans: new WeakMap(), definitions: vm.inspector ? vm.typeSystem.types : null,
      classes: indexRows(classes, 2), fields: indexRows(fields, 1)};
    caches.set(state, cache);
  }
  return cache;
}

function indexRows(rows, column) {
  const index = new Map();
  for (const row of rows) {
    const previous = index.get(row[column]);
    if (previous) previous.duplicate = true;
    else index.set(row[column], {row, duplicate: false});
  }
  return index;
}

function requireClosed(table) {
  if (table.containsGenericParameters || /^!!?\d+$/.test(table.name)) invalid('Value layout requires a closed type');
  if (table.flags.byRef || table.name === 'System.Void') invalid('Unsupported managed value layout: ' + table.name);
  if (table.flags.pointer || table.flags.refStruct || table.name === 'System.TypedReference') unsupported(table.name);
  if (table.flags.nullable && (!table.nullableType?.flags.valueType || table.nullableType.flags.nullable)) {
    invalid('Nullable layout requires a non-nullable value type');
  }
}

function aggregateLayout(vm, table, cache, context) {
  const definition = cache.definitions?.get(table.definitionToken);
  if (!definition && !table.flags.nullable && !table.flags.runtimeValue) unsupported(table.name);
  const row = table.definitionToken & 0xffffff;
  const classLayout = cache.classes.get(row);
  if (classLayout?.duplicate) invalid('Duplicate ClassLayout rows');
  const packing = classLayout?.row[0] || 8;
  if (!packingSizes.has(packing)) invalid('Invalid packing size');
  const layoutKind = definition?.flags & 0x18;
  if (layoutKind === 0x18) invalid('Conflicting value layout flags');
  const explicit = layoutKind === 0x10;
  if (explicit && table.typeArguments.length) invalid('Generic types cannot have explicit layout');
  const fields = table.flags.nullable
    ? [{type: vm.heap.methodTables.get('bool')}, {type: table.nullableType}]
    : table.fields;
  if (definition && fields.length && !(definition.flags & 0x18) &&
      !(context.managed && hasManagedStateMachineLayout(vm, table))) unsupported('auto-layout ' + table.name);
  context.remainingFields -= fields.length;
  if (context.remainingFields < 0) unsupported('value layout field budget exceeded');
  const offsets = [];
  let size = 0;
  let alignment = 1;
  let containsReferences = false;
  const references = [];
  const scalars = [];
  for (const field of fields) {
    const layout = layoutFor(vm, field.type, cache, context);
    const fieldAlignment = Math.min(packing, layout.alignment);
    const fieldLayout = explicit ? cache.fields.get(field.token & 0xffffff) : null;
    if (explicit && (!fieldLayout || fieldLayout.duplicate)) invalid('Explicit-layout field requires exactly one offset');
    const offset = explicit ? fieldLayout.row[0] : align(size, fieldAlignment);
    if (!Number.isSafeInteger(offset) || offset < 0) invalid('Invalid explicit-layout field offset');
    offsets.push(offset);
    size = Math.max(size, offset + layout.size);
    alignment = Math.max(alignment, fieldAlignment);
    containsReferences ||= layout.containsReferences;
    const memory = memoryShapes.get(layout);
    for (const reference of memory.references) references.push(offset + reference);
    for (const [start, end] of memory.scalars) scalars.push([offset + start, offset + end]);
  }
  const orderedReferences = explicit && containsReferences
    ? validateReferenceLayout(references, scalars, vm.heap.methodTables.nativeIntBits / 8, invalid) : references;
  const declaredSize = classLayout?.row[1] ?? 0;
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) invalid('Invalid declared class size');
  return plan(Math.max(1, declaredSize, align(size, alignment)), alignment, containsReferences, offsets,
    {references: orderedReferences, scalars});
}

function layoutFor(vm, table, cache, context) {
  requireClosed(table);
  if (context.plans.has(table)) return context.plans.get(table);
  const active = context.active;
  if (active.has(table)) invalid('Recursive value layout');
  if (active.size >= 128) invalid('Value layout nesting limit exceeded');
  if (table.flags.valueType && !table.flags.runtimeValue &&
      (table.flags.external || table.flags.dynamic && !table.flags.enum)) unsupported(table.name);
  let layout;
  if (table.enumUnderlyingType) {
    active.add(table);
    try { layout = layoutFor(vm, table.enumUnderlyingType, cache, context); }
    finally { active.delete(table); }
  } else if (!table.flags.valueType) {
    const size = vm.heap.methodTables.nativeIntBits / 8;
    layout = plan(size, size, true);
  } else if (table.flags.primitive || table.name === 'System.Decimal') {
    layout = plan(table.valueSize, Math.min(table.valueSize, 8), false);
  } else {
    active.add(table);
    try { layout = aggregateLayout(vm, table, cache, context); }
    finally { active.delete(table); }
  }
  context.plans.set(table, layout);
  return layout;
}

/** Immutable ABI byte layout for supported closed values and reference slots, with bounded nesting. */
export function valueLayout(vm, type) {
  const table = vm.inspector ? vm.typeSystem.table(type) : vm.heap.methodTables.get(type);
  const cache = cacheFor(vm);
  if (cache.plans.has(table)) return cache.plans.get(table);
  return layoutFor(vm, table, cache, {active: new Set(), remainingFields: maxLayoutFields, plans: cache.plans, managed: false});
}

/** Canonical logical field storage for managed copies and stack quotas; never used for raw bytes or sizeof. */
export function managedValueLayout(vm, type) {
  const table = vm.inspector ? vm.typeSystem.table(type) : vm.heap.methodTables.get(type);
  const cache = cacheFor(vm);
  if (cache.managedPlans.has(table)) return cache.managedPlans.get(table);
  return layoutFor(vm, table, cache, {active: new Set(), remainingFields: maxLayoutFields, plans: cache.managedPlans, managed: true});
}

/** sizeof resolves the executing generic context through the existing MethodTable service. */
export function sizeOfType(vm, type) {
  return valueLayout(vm, type).size;
}

/** Physical GC-reference offsets; scalar byte overlays never encode managed handles. */
export function valueReferenceOffsets(vm, type) {
  return memoryShapes.get(valueLayout(vm, type)).references;
}
