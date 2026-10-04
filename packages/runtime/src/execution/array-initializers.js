import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {rawArrayBytes} from './array-storage.js';

const plans = new WeakMap();

function initializerPlans(vm) {
  if (!vm.inspector) throw new ManagedFault('NotSupportedException', 'FieldRVA initialization requires a CIL image');
  const epoch = executionCodeState(vm);
  let plan = plans.get(epoch);
  if (!plan) {
    const rows = vm.inspector.metadata.rows;
    const fieldRows = rows[29] ?? [], layoutRows = rows[15] ?? [];
    if (fieldRows.length + layoutRows.length > 262144) {
      throw new ManagedFault('InvalidProgramException', 'FieldRVA metadata budget exceeded');
    }
    const fields = new Map(fieldRows.map(row => [row[1], row[0]]));
    const sizes = new Map(layoutRows.map(row => [row[2], row[1]]));
    plans.set(epoch, plan = {fields, sizes, tokens: new Map()});
  }
  return plan;
}

/** Resolve immutable PE offsets once per code epoch, without retaining mutable heap backing. */
export function fieldInitializer(vm, token) {
  const plans = initializerPlans(vm);
  let plan = plans.tokens.get(token);
  if (plan) return plan;
  const field = vm.inspector.resolveToken(token);
  const rva = plans.fields.get(token & 0xffffff);
  if (token >>> 24 !== 4 || !field.isStatic || !(field.flags & 0x100) || rva === undefined) {
    throw new ManagedFault('ArgumentException', 'Field has no RVA initializer');
  }
  const type = vm.typeSystem.table(field.signature.type);
  const size = plans.sizes.get(type.definitionToken & 0xffffff) ?? type.valueSize;
  if (!Number.isSafeInteger(size) || size < 1) throw new ManagedFault('ArgumentException', 'Field initializer has no valid layout');
  plan = Object.freeze({offset: vm.inspector.pe.offsetOf(rva, size), size});
  plans.tokens.set(token, plan);
  return plan;
}

export function arrayInitializer(vm, record, handle) {
  if (!Object.isFrozen(handle) || handle?.runtimeHandle !== 'field' || handle.owner !== vm.snapshotOwner) {
    throw new ManagedFault('ArgumentException', 'InitializeArray requires an owned field handle');
  }
  let bytes;
  try { bytes = rawArrayBytes(record.data); }
  catch { throw new ManagedFault('ArgumentException', 'InitializeArray requires primitive storage'); }
  const plan = fieldInitializer(vm, handle.token);
  if (bytes.length > plan.size) throw new ManagedFault('ArgumentException', 'Field initializer is smaller than the array');
  return {initializerToken: handle.token, initializerOffset: plan.offset, length: bytes.length};
}
