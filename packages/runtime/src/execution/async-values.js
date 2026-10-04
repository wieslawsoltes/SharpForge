import {asyncStateMachine} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {defaults} from './numeric-ops.js';
import {executionCodeState} from './code-version.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };
const layouts = new WeakMap();

function requireFiniteFields(vm, table) {
  const epoch = executionCodeState(vm);
  let known = layouts.get(epoch);
  if (!known) layouts.set(epoch, known = new WeakSet());
  if (known.has(table)) return;
  const active = new Set(), pending = [{table, exit: false}];
  let remaining = 65_536;
  while (pending.length) {
    const next = pending.pop(), current = next.table;
    if (next.exit) { active.delete(current); known.add(current); continue; }
    if (known.has(current)) continue;
    if (active.has(current) || active.size >= 128) invalid('Recursive or excessive async value layout');
    active.add(current);
    pending.push({table: current, exit: true});
    for (const field of current.fields) {
      if (--remaining < 0) invalid('Async value layout field budget exceeded');
      if (field.type.flags.valueType && !field.type.flags.primitive && !field.type.flags.enum) {
        pending.push({table: field.type, exit: false});
      }
    }
  }
}

/** Only ABI values and metadata-proved internal state machines gain managed fields in value storage. */
export function isAsyncValue(vm, table) {
  return !!table.flags.asyncValue || !!(vm.inspector && table.flags.valueType && asyncStateMachine(vm.inspector, table.name));
}

function defaultField(vm, table, ordinaryValue) {
  if (!table.flags.valueType) return null;
  if (isAsyncValue(vm, table)) return asyncValue(vm, table, null, ordinaryValue);
  if (table.flags.primitive || table.flags.enum) return defaults(table.enumUnderlyingType?.name ?? table.name, vm.options);
  if (!ordinaryValue) invalid('Async value has unsupported nested storage');
  return ordinaryValue(vm, table);
}

/** Frozen payloads own a flat GC inventory; copies preserve managed object identity, never mutable field aliases. */
export function asyncValue(vm, table, source = null, ordinaryValue = null) {
  if (table.registry !== vm.heap.methodTables || table.containsGenericParameters || !isAsyncValue(vm, table)) {
    invalid('Async value storage requires a closed type from this VM');
  }
  requireFiniteFields(vm, table);
  if (table.fields.length > 65_536) invalid('Async state-machine field budget exceeded');
  if (source !== null && (!Object.isFrozen(source) || source.valueType !== table ||
      !Object.isFrozen(source.fields) || source.fields.length !== table.fields.length)) invalid('Async value identity or payload mismatch');
  const fields = [], references = [];
  for (let index = 0; index < table.fields.length; index++) {
    const field = table.fields[index], type = field.type;
    if (type.flags.byRef || type.flags.pointer || type.flags.refStruct) invalid('Async state-machine fields cannot contain managed addresses');
    let value = source === null ? defaultField(vm, type, ordinaryValue) : source.fields[index];
    if (!type.flags.valueType) {
      if (value !== null && (!isReference(value) || !vm.typeSystem.castCache.isAssignableFrom(type, vm.heap.get(value).methodTable))) {
        invalid('Async value reference field has incompatible storage');
      }
    } else value = vm.storage(value, field.storageType ?? type.name);
    fields.push(value);
    if (isReference(value)) references.push(value);
    else if (value?.managedReferences) references.push(...value.managedReferences);
    if (references.length > 65_536) invalid('Async state-machine reference budget exceeded');
  }
  return Object.freeze({valueType: table, fields: Object.freeze(fields), managedReferences: Object.freeze(references)});
}

/** Construct a builder/awaiter value from its single shared managed Task reference. */
export function asyncTaskValue(vm, type, task = null) {
  const table = vm.typeSystem.table(type);
  return asyncValue(vm, table, Object.freeze({valueType: table, fields: Object.freeze(table.fields.length ? [task] : [])}));
}

/** Copying a declared value slot cannot turn null into its default value. */
export function copyAsyncValue(vm, table, source) {
  if (source === null || source === undefined) invalid('Async value storage requires a value, not null');
  return asyncValue(vm, table, source);
}
