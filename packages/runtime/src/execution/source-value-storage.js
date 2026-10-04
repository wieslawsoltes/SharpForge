import {
  ManagedFault
} from '../heap.js';
import {
  sourceStore
} from './source-storage.js';
import {
  isValueRecord,
  createValue
} from './value-types.js';

const localPlans = new WeakMap();

/** Scalars retain their existing carriers; owned value and address carriers use typed storage. */
export function sourceTypedValue(vm, value, type) {
  if (value === null || typeof value !== 'object') return value;
  if (value.valueType || value.byref || value.memoryPointer || value.span || value.nullableType ||
    value.typedReference || value.runtimeArgumentHandle || value.argIterator) return sourceStore(vm, value, type);
  return value;
}

/** Struct locals have zeroed field storage before individual fields can be assigned. */
export function initializeSourceValueLocals(vm, frame, method, argumentsLength) {
  const registry = vm.heap.methodTables;
  let plan = localPlans.get(registry);
  if (!plan) {
    plan = {methods: new WeakMap(), types: new Set(vm.image.types.filter(type => type.valueType).map(type => type.name))};
    localPlans.set(registry, plan);
  }
  if (!plan.types.size) return;
  const previous = plan.methods.get(method);
  let slots = previous?.locals === method.locals ? previous.slots : null;
  if (!slots) {
    slots = [];
    for (let index = 0; index < method.locals.length; index++) {
      const table = registry.get(method.locals[index].type);
      if (plan.types.has(table.name)) slots.push([index, table]);
    }
    plan.methods.set(method, {locals: method.locals, slots});
  }
  for (const [index, table] of slots) {
    if (index >= argumentsLength) frame.locals[index] = createValue(vm, table);
  }
}

function fieldAt(value, index) {
  if (!Number.isInteger(index) || index < 0 || index >= value.fields.length) {
    throw new ManagedFault('InvalidProgramException', 'Invalid value field index');
  }
  return value.fields[index];
}

/** Reading a value field never creates a mutable alias to the enclosing record. */
export function readSourceField(vm, receiver, index) {
  const value = receiver?.byref ? vm.dereference(receiver) : receiver;
  if (isValueRecord(value)) return fieldAt(value, index);
  const record = vm.heap.get(value);
  if (record.kind !== 'object' || !Number.isInteger(index) || index < 0 || index >= record.data.length) {
    throw new ManagedFault('InvalidProgramException', 'Invalid field index');
  }
  return record.data[index];
}

/** Struct writes replace the addressed value; class writes retain their heap field identity. */
export function writeSourceField(vm, receiver, index, value) {
  if (receiver?.byref) return vm.dereference(vm.address('field', index, receiver), true, value);
  if (isValueRecord(receiver)) throw new ManagedFault('InvalidProgramException', 'A value field write requires an address');
  const record = vm.heap.get(receiver);
  if (record.kind !== 'object' || !Number.isInteger(index) || index < 0 || index >= record.data.length) {
    throw new ManagedFault('InvalidProgramException', 'Invalid field index');
  }
  const oldValue = record.data[index];
  value = sourceTypedValue(vm, value, record.methodTable.fields[index].type.name);
  record.data[index] = value;
  vm.notifyWrite({
    kind: 'field',
    handle: receiver.h,
    generation: receiver.g,
    index,
    value,
    oldValue
  });
  return value;
}

export function newSourceValue(vm, type) {
  return createValue(vm, vm.heap.methodTables.get(type.name));
}
