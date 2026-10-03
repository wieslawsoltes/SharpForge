import {ManagedFault} from '../heap.js';

const align = (size, alignment) => Math.ceil(size / alignment) * alignment;

/** ECMA sequential/explicit value layout, in bytes, for the configured native ABI. */
export function valueLayout(vm, type, active = new Set()) {
  const table = vm.inspector ? vm.typeSystem.table(type) : vm.heap.methodTables.get(type);
  vm.valueLayouts ??= new Map();
  if (vm.valueLayouts.has(table)) return vm.valueLayouts.get(table);
  if (active.has(table)) throw new ManagedFault('TypeLoadException', 'Recursive value layout');
  if (table.enumUnderlyingType) return valueLayout(vm, table.enumUnderlyingType, active);
  if (table.flags.primitive || table.name === 'System.Decimal' || !table.flags.valueType) {
    const size = table.flags.valueType ? table.valueSize : vm.heap.methodTables.nativeIntBits / 8;
    return Object.freeze({size, alignment: Math.min(size, 8), containsReferences: !table.flags.valueType, offsets: []});
  }
  active.add(table);
  const metadata = vm.inspector?.metadata;
  const typeRow = table.definitionToken & 0xffffff;
  const definition = vm.inspector?.types.find(item => item.token === table.definitionToken);
  const classLayout = metadata?.rows[15]?.find(row => row[2] === typeRow);
  const packing = classLayout?.[0] || 8;
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(packing)) throw new ManagedFault('TypeLoadException', 'Invalid packing size');
  const explicit = !!(definition?.flags & 0x10);
  const fields = table.flags.nullable
    ? [{type: vm.heap.methodTables.get('bool')}, {type: table.nullableType}]
    : table.fields;
  const offsets = [];
  let size = 0;
  let alignment = 1;
  let containsReferences = false;
  for (const field of fields) {
    const layout = valueLayout(vm, field.type, active);
    const fieldAlignment = Math.min(packing, layout.alignment);
    const row = explicit ? metadata?.rows[16]?.find(item => item[1] === (field.token & 0xffffff)) : null;
    if (explicit && !row) throw new ManagedFault('TypeLoadException', 'Explicit-layout field has no offset');
    const offset = row ? row[0] : align(size, fieldAlignment);
    offsets.push(offset);
    size = Math.max(size, offset + layout.size);
    alignment = Math.max(alignment, fieldAlignment);
    containsReferences ||= layout.containsReferences;
  }
  active.delete(table);
  size = Math.max(1, classLayout?.[1] ?? 0, align(size, alignment));
  const layout = Object.freeze({size, alignment, containsReferences, offsets: Object.freeze(offsets)});
  vm.valueLayouts.set(table, layout);
  return layout;
}
