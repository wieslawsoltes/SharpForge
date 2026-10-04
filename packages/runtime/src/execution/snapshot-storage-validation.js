import {isReference} from './managed-fault.js';
import {castCacheFor} from './casting.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';
import {snapshotOwnedTable} from './snapshot-address-validation.js';
import {invalidSnapshot as fail} from './snapshot-validation-helpers.js';

/** Validate an already normalized pending store using only captured references and immutable type metadata. */
export function validateSnapshotStoredValue(context, type, value) {
  const pending = [{type, value, depth: 0}];
  let count = 0;
  while (pending.length) {
    const {type: current, value: item, depth} = pending.pop();
    if (++count > 65536 || depth > 128) fail('array continuation value limit');
    snapshotOwnedTable(context, current);
    if (item?.byref || item?.span || item?.memoryPointer || item?.typedReference || item?.runtimeArgumentHandle || item?.argIterator) {
      fail('array continuation scoped value');
    }
    if (!current.flags.valueType) {
      if (item === null) continue;
      if (!isReference(item) || !castCacheFor(context.vm.heap.methodTables)
        .isAssignableFrom(current, context.referenceRecord(item).methodTable)) fail('array continuation reference value type');
      continue;
    }
    if (current.flags.nullable) {
      if (!Object.isFrozen(item) || item?.nullableType !== current || typeof item.hasValue !== 'boolean' ||
          !item.hasValue && item.value !== null) fail('array continuation nullable value');
      if (item.hasValue) pending.push({type: current.nullableType, value: item.value, depth: depth + 1});
      continue;
    }
    const scalar = scalarStorageGuard(current.enumUnderlyingType?.name ?? current.name);
    if (scalar) {
      const sourceScalar = context.snapshot.engine === 'source' &&
        (current.name === 'System.Boolean' && typeof item === 'boolean' || current.name === 'System.Double' && typeof item === 'number');
      if (!sourceScalar && !scalar(item, context.vm.options)) fail('array continuation scalar value type');
      continue;
    }
    if (current.flags.dynamic && item === null) continue;
    if (current.flags.dynamic && isReference(item)) {
      if (context.referenceRecord(item).methodTable !== current) fail('array continuation runtime value type');
      continue;
    }
    if (!Object.isFrozen(item) || item?.valueType !== current || !Array.isArray(item.fields) ||
        !Object.isFrozen(item.fields) || item.fields.length !== current.fields.length) fail('array continuation aggregate value');
    current.fields.forEach((field, index) => pending.push({type: field.type, value: item.fields[index], depth: depth + 1}));
  }
}
