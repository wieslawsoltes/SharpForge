import {decodeCoded} from '@sharpforge/cil';
import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {defaults, storage as numericStorage} from './numeric-ops.js';
import {valueLayout} from './value-layout.js';
import {executionCodeState} from './code-version.js';

const plans = new WeakMap();
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };
const unsupported = name => { throw new ManagedFault('NotSupportedException', 'Struct storage is not implemented: ' + name); };
export const isValueRecord = value => !!value?.valueType && Array.isArray(value.fields);
export const isAggregateType = table => table.flags.valueType && !table.flags.primitive && !table.flags.enum &&
  table.name !== 'System.Decimal' && !(table.flags.dynamic && frameworkType(table.name)?.kind === 'value');

function cacheFor(vm) {
  const epoch = executionCodeState(vm);
  let cache = plans.get(epoch);
  if (!cache) {
    const restricted = new Set();
    const attributes = vm.inspector?.metadata.rows[12] ?? [];
    if (attributes.length > 262_144) unsupported('custom attribute work budget exceeded');
    for (const row of attributes) {
      const parent = decodeCoded('HasCustomAttribute', row[0]);
      if (parent >>> 24 !== 2) continue;
      const attribute = vm.inspector.resolveToken(decodeCoded('CustomAttributeType', row[1]));
      if (['System.Runtime.CompilerServices.IsByRefLikeAttribute', 'System.Runtime.CompilerServices.IsReadOnlyAttribute']
        .includes(attribute.owner)) restricted.add(parent);
    }
    cache = {types: new WeakSet(), restricted};
    plans.set(epoch, cache);
  }
  return cache;
}

function supported(vm, table) {
  const cache = cacheFor(vm);
  if (cache.types.has(table)) return;
  const definition = vm.typeSystem.types.get(table.definitionToken);
  if (!definition || (definition.flags & 0x18) !== 8 || table.flags.nullable || table.flags.refStruct ||
      cache.restricted.has(table.definitionToken)) unsupported(table.name);
  if (valueLayout(vm, table).containsReferences) unsupported('managed-reference fields in ' + table.name);
  cache.types.add(table);
}

function record(vm, table, source, budget) {
  supported(vm, table);
  if (source !== null && (!isValueRecord(source) || source.valueType !== table || !Object.isFrozen(source) ||
      !Object.isFrozen(source.fields) || source.fields.length !== table.fields.length)) {
    invalid('Struct payload or type identity does not match its declared storage');
  }
  budget.fields -= table.fields.length;
  if (budget.fields < 0) throw new ManagedFault('OutOfMemoryException', 'Struct copy exceeds its field budget');
  const fields = table.fields.map((field, index) => {
    const type = field.type;
    if (isAggregateType(type)) {
      if (source !== null && source.fields[index] === null) invalid('Nested struct field requires a value');
      return record(vm, type, source === null ? null : source.fields[index], budget);
    }
    const value = source === null ? defaults(type.enumUnderlyingType?.name ?? type.name, vm.options) : source.fields[index];
    if (value === undefined || isReference(value) || value?.byref || value?.valueType || value?.methodPointer) {
      invalid('Struct scalar field has an incompatible value');
    }
    return numericStorage(value, type.enumUnderlyingType?.name ?? type.name, vm.options);
  });
  return Object.freeze({valueType: table, fields: Object.freeze(fields)});
}

/** Reference-free sequential values have immutable owned fields; copies never expose mutable host aliases. */
export function createValue(vm, table, source = null) {
  if (table.registry !== vm.heap.methodTables) invalid('Struct type belongs to another VM');
  return record(vm, table, source, {fields: 65_536});
}

export function replaceValueField(vm, value, index, replacement) {
  const table = value.valueType;
  if (table.registry !== vm.heap.methodTables || !Number.isInteger(index) || index < 0 || index >= table.fields.length) {
    invalid('Invalid struct field address');
  }
  const fields = [...value.fields];
  fields[index] = replacement;
  return createValue(vm, table, Object.freeze({valueType: table, fields: Object.freeze(fields)}));
}

/** Until value receivers are implemented, neither newobj nor instance calls may class-allocate a user struct. */
export function rejectValueInstance(vm, owner) {
  const table = vm.typeSystem.table(owner);
  if (table.flags.valueType && vm.typeSystem.types.has(table.definitionToken)) {
    unsupported('user value-type instance constructors and methods');
  }
}
