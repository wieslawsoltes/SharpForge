import {frameworkType, propertiesFor} from '@sharpforge/framework';
import {nullableElementType} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';

/** Framework value adapters use managed property carriers at their public ABI boundary. */
export function isFrameworkValueType(type, registry = null) {
  if (typeof type !== 'string' || nullableElementType(type)) return false;
  const name = type;
  const definition = frameworkType(name);
  return definition?.name === name && definition.kind === 'value' && !registry?.descriptors.has(name);
}

function copy(vm, value, type, budget, active) {
  if (value === null || value === undefined || !isFrameworkValueType(type, vm.heap.methodTables)) return value;
  if (!isReference(value)) throw new ManagedFault('InvalidCastException', 'A registered framework value is required');
  const record = vm.heap.get(value), table = vm.heap.methodTables.get(type);
  if (record.methodTable !== table || record.kind !== 'host' || record.data.length % 2) {
    throw new ManagedFault('InvalidCastException', 'Framework value storage requires its exact managed type');
  }
  if (active.has(record) || active.size >= 128) throw new ManagedFault('InvalidProgramException', 'Framework value cycle or depth limit');
  budget.fields -= record.data.length / 2;
  if (budget.fields < 0) throw new ManagedFault('OutOfMemoryException', 'Framework value copy exceeds its field budget');
  active.add(record);
  try {
    const data = [], definitions = propertiesFor(type);
    for (let index = 0; index < record.data.length; index += 2) {
      const name = record.data[index];
      if (typeof name !== 'string') throw new ManagedFault('InvalidProgramException', 'Invalid framework value field');
      // Native models and observers belong to the old carrier, never to a copied C# value.
      if (name.startsWith('$')) continue;
      const field = copy(vm, record.data[index + 1], definitions[name]?.type, budget, active);
      vm.heap.pins.push(field);
      data.push(name, field);
    }
    const result = vm.heap.allocate('host', table, data);
    vm.heap.pins.push(result);
    return result;
  } finally { active.delete(record); }
}

/** Shared source/CIL storage projection; nested registered values copy, reference fields retain their identity. */
export function copyFrameworkValue(vm, value, type) {
  if (value === null || value === undefined || !isFrameworkValueType(type, vm.heap.methodTables)) return value;
  return vm.heap.withRoots([value], () => copy(vm, value, type, {fields: 65536}, new Set()));
}
