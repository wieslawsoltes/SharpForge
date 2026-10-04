import {ManagedFault, isReference} from '../heap.js';
import {findContracts} from '@sharpforge/framework';

const fields = Object.freeze({
  'System.DateTimeOffset': Object.freeze({UnixTimeMilliseconds: 'long', Year: 'int', Month: 'int', Day: 'int'}),
  'System.TimeSpan': Object.freeze({TotalMilliseconds: 'double', TotalSeconds: 'double'})
});
const initial = Object.freeze({
  'System.DateTimeOffset': Object.freeze({UnixTimeMilliseconds: -62135596800000n, Year: 1, Month: 1, Day: 1}),
  'System.TimeSpan': Object.freeze({TotalMilliseconds: 0, TotalSeconds: 0})
});

/** The two approved UI temporal values use scalar records at the managed ABI boundary. */
export function isNullableRecordType(type) { return Object.hasOwn(fields, type); }

/** Logical stack bytes include HasValue and the admitted scalar record, aligned to eight bytes. */
export function nullableRecordStorageBytes(type) {
  if (!isNullableRecordType(type)) return null;
  let bytes = 8;
  for (const fieldType of Object.values(fields[type])) {
    const width = fieldType === 'int' ? 4 : 8;
    bytes = Math.ceil(bytes / width) * width + width;
  }
  return Math.ceil(bytes / 8) * 8;
}

/** Nullable value records contain scalar data only, so the tracing heap has no hidden reference edges to discover. */
export function nullableRecord(vm, type, value, present) {
  if (!fields[type]) return null;
  if (!present) return Object.freeze({valueType: type, ...initial[type]});
  const context = vm.platform.ui;
  const reference = isReference(value);
  if ((reference ? context.typeOf(value) : value?.valueType) !== type) {
    throw new ManagedFault('InvalidCastException', 'Nullable value record type mismatch');
  }
  const data = {valueType: type};
  for (const [field, fieldType] of Object.entries(fields[type])) {
    const raw = reference ? readScalar(vm, value, type, field, fieldType) : value[field];
    const scalar = context.properties.toNative(raw, fieldType);
    data[field] = copyScalar(scalar, fieldType);
  }
  return Object.freeze(data);
}

function readScalar(vm, value, type, field, fieldType) {
  const getter = findContracts(type, 'get_' + field, false)
    .find(member => member.kind === 'get' && member.parameters.length === 0 && member.result === fieldType);
  if (!getter) throw new ManagedFault('MissingMethodException', 'Nullable value record getter is unavailable');
  return vm.platform.invoke(getter, [value]);
}

function copyScalar(value, type) {
  if (type === 'long') {
    const integer = typeof value === 'bigint' ? value : Number.isSafeInteger(value) ? BigInt(value) : null;
    if (integer !== null && BigInt.asIntN(64, integer) === integer) return integer;
  } else if (typeof value === 'number' && Number.isFinite(value) &&
    (type === 'double' || Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)) return value;
  throw new ManagedFault('InvalidProgramException', 'Nullable value records require exact finite scalar fields');
}

/** Re-materialize the value only at an ABI read; snapshots hold no mutable managed record alias. */
export function materializeNullableRecord(vm, value) {
  return value?.valueType && fields[value.valueType] ? vm.platform.ui.managed(value, value.valueType) : value;
}
