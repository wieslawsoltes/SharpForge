import {ManagedFault} from '../heap.js';
import {valueLayout} from './value-layout.js';
import {scalarAccess} from './scalar-bytes.js';

const plans = new WeakMap();
const explicitPlans = new WeakMap();
const invalid = message => { throw new ManagedFault('TypeLoadException', message); };
const unsupported = type => {
  throw new ManagedFault('NotSupportedException', 'Explicit storage for this field type is not implemented: ' + type.name);
};

function flatten(vm, table, offset, cells, active = new Set()) {
  if (active.size > 128 || active.has(table) || table.containsGenericParameters) invalid('Invalid recursive or open explicit layout');
  if (cells.length >= 65536) invalid('Explicit layout field expansion limit exceeded');
  if (table.flags.byRef || table.name === 'System.Void') invalid('Invalid explicit-layout field type');
  if (table.flags.external || table.flags.pointer || table.flags.refStruct || table.flags.nullable) unsupported(table);
  const definition = vm.inspector?.types.find(type => type.token === table.definitionToken);
  if (definition?.flags & 0x10 && table.typeArguments.length) invalid('Generic types cannot have explicit layout');
  const layout = valueLayout(vm, table);
  if (!table.flags.valueType || scalarAccess(table)) {
    cells.push({start: offset, end: offset + layout.size, reference: !table.flags.valueType});
    return;
  }
  if (table.name === 'System.Decimal' || table.flags.dynamic || !definition && !table.fields.length) unsupported(table);
  active.add(table);
  const start = cells.length;
  table.fields.forEach((field, index) => flatten(vm, field.type, offset + layout.offsets[index], cells, active));
  active.delete(table);
  // Padding belongs to the containing value field and cannot conceal a GC slot.
  const intervals = cells.slice(start).sort((left, right) => left.start - right.start);
  let end = offset;
  for (const interval of intervals) {
    if (interval.start > end) cells.push({start: end, end: interval.start, reference: false});
    end = Math.max(end, interval.end);
  }
  if (end < offset + layout.size) cells.push({start: end, end: offset + layout.size, reference: false});
}

function validateCells(cells, nativeBytes) {
  const references = cells.filter(cell => cell.reference).sort((left, right) => left.start - right.start);
  const scalars = cells.filter(cell => !cell.reference).sort((left, right) => left.start - right.start);
  let previous = null;
  let scalarIndex = 0;
  let scalarEnd = -1;
  for (const reference of references) {
    if (reference.start % nativeBytes) invalid('Explicit-layout reference field is not naturally aligned');
    if (previous && reference.start < previous.end && reference.start !== previous.start) {
      invalid('Explicit-layout reference fields partially overlap');
    }
    while (scalarIndex < scalars.length && scalars[scalarIndex].start < reference.end) {
      scalarEnd = Math.max(scalarEnd, scalars[scalarIndex++].end);
    }
    if (scalarEnd > reference.start) invalid('Explicit-layout reference overlaps nonreference storage');
    previous = reference;
  }
}

/** Validate a byte-backed value, including sequential views nested inside a union. */
export function byteLayout(vm, table) {
  if (plans.has(table)) return plans.get(table);
  if (!table.flags.valueType || table.containsGenericParameters) invalid('Closed value storage is required');
  if (table.flags.refStruct || table.flags.nullable || table.flags.dynamic || table.name === 'System.Decimal' || scalarAccess(table)) {
    unsupported(table);
  }
  const layout = valueLayout(vm, table);
  const limit = vm.options?.maxValueTypeBytes ?? Math.min(vm.heap.maxBytes, 1024 * 1024);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid maxValueTypeBytes');
  if (!Number.isSafeInteger(layout.size) || layout.size > limit) {
    throw new ManagedFault('OutOfMemoryException', 'Explicit value exceeds the configured byte budget');
  }
  const cells = [];
  table.fields.forEach((field, index) => flatten(vm, field.type, layout.offsets[index], cells));
  validateCells(cells, vm.heap.methodTables.nativeIntBits / 8);
  const plan = Object.freeze({size: layout.size, offsets: layout.offsets, containsReferences: layout.containsReferences});
  plans.set(table, plan);
  return plan;
}

/** Derived per-MethodTable layout; no mutable bytes or execution state are cached. */
export function explicitLayout(vm, table) {
  if (explicitPlans.has(table)) return explicitPlans.get(table);
  const definition = vm.inspector?.types.find(type => type.token === table.definitionToken);
  const plan = table.flags.valueType && (definition?.flags & 0x10) ? byteLayout(vm, table) : null;
  if (plan && table.typeArguments.length) invalid('Generic types cannot have explicit layout');
  explicitPlans.set(table, plan);
  return plan;
}
