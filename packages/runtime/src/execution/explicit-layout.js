import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {valueLayout} from './value-layout.js';
import {scalarAccess} from './scalar-bytes.js';

const caches = new WeakMap();
const unsupported = name => {
  throw new ManagedFault('NotSupportedException', 'Explicit scalar storage is not implemented: ' + name);
};

function cacheFor(vm) {
  const epoch = executionCodeState(vm);
  let cache = caches.get(epoch);
  if (!cache) caches.set(epoch, cache = new WeakMap());
  return cache;
}

function plan(vm, table, cache, context) {
  if (cache.has(table)) return cache.get(table);
  if (table.registry !== vm.heap.methodTables || table.containsGenericParameters || context.active.has(table)) {
    throw new ManagedFault('TypeLoadException', 'Explicit scalar layout requires an owned closed nonrecursive type');
  }
  if (context.active.size >= 128) unsupported('nesting limit exceeded');
  if (table.flags.nullable || table.flags.refStruct || table.flags.pointer || table.name === 'System.Decimal') unsupported(table.name);
  const layout = valueLayout(vm, table);
  if (!table.flags.valueType) return layout;
  if (table.flags.external || table.flags.dynamic && !table.flags.enum) unsupported(table.name);
  context.remaining -= table.fields.length;
  if (context.remaining < 0) unsupported('field expansion limit exceeded');
  if (!scalarAccess(table)) {
    if (!vm.typeSystem.types.has(table.definitionToken)) unsupported(table.name);
    context.active.add(table);
    try {
      for (const field of table.fields) plan(vm, field.type, cache, context);
    } finally { context.active.delete(table); }
  }
  cache.set(table, layout);
  return layout;
}

/** Metadata-only overlay layout; managed slots remain separate from byte-addressable scalars. */
export function byteLayout(vm, table) {
  const cache = cacheFor(vm);
  if (cache.has(table)) return cache.get(table);
  return plan(vm, table, cache, {active: new Set(), remaining: 65_536});
}

export function hasExplicitLayout(vm, table) {
  return (vm.typeSystem?.types.get(table.definitionToken)?.flags & 0x18) === 0x10;
}

/** Host copy-work limit; checked on each operation rather than cached with metadata. */
export function explicitByteBudget(vm) {
  const limit = vm.options.maxValueTypeBytes ?? Math.min(vm.heap.maxBytes, 1024 * 1024);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16 * 1024 * 1024) throw new RangeError('Invalid maxValueTypeBytes');
  return limit;
}
