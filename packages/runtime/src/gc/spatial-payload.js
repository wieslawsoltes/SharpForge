import {ManagedFault} from './fault.js';
import {HostPayloadRoots} from './host-payload-roots.js';

export function assertActiveStorage(binding) {
  if (binding.block.released) {
    throw new ManagedFault('InvalidReferenceException', 'The managed array backing store has been reclaimed');
  }
}

/** Physical view operations must not follow record.data: a host may wrap that view. */
export function readStoredSlot(binding, index) {
  assertActiveStorage(binding);
  return binding.codec
    ? binding.codec.read(binding.arena.view, binding.block.offset + index * binding.codec.size)
    : binding.arena.read(binding.block, index);
}

export function writeStoredSlot(binding, index, value) {
  assertActiveStorage(binding);
  if (binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen managed data is read-only');
  if (!Number.isSafeInteger(index) || index < 0 || index >= binding.length) {
    throw new ManagedFault('IndexOutOfRangeException', 'Managed array index exceeds its length');
  }
  if (binding.codec) binding.codec.write(binding.arena.view, binding.block.offset + index * binding.codec.size, value);
  else binding.arena.write(binding.block, index, value);
  return true;
}

/** Public replacement stays observable; resizing still needs the transactional heap API. */
export function publicPayload(binding, roots = null) {
  const data = binding.record.data;
  if (data === binding.view) return data;
  assertActiveStorage(binding);
  if (binding.readOnly || binding.record.kind === 'string') {
    throw new ManagedFault('InvalidOperationException', 'Immutable managed payload cannot be replaced');
  }
  const owned = roots === null;
  roots ??= new HostPayloadRoots(binding.owner.heap);
  try {
    if (owned) roots.retain(binding.reference);
    if (!Array.isArray(data) && !ArrayBuffer.isView(data)) {
      throw new ManagedFault('ArgumentException', 'Managed replacement payload must be an indexed array');
    }
    const length = data.length;
    assertActiveStorage(binding);
    if (binding.record.data !== data) {
      throw new ManagedFault('InvalidOperationException', 'Managed payload changed during a host storage operation');
    }
    if (!Number.isSafeInteger(length)) {
      throw new ManagedFault('ArgumentException', 'Managed replacement payload must be an indexed array');
    }
    if (length !== binding.length) {
      throw new ManagedFault('InvalidOperationException', 'Managed payload length changed; use heap.replaceData to resize storage');
    }
    return data;
  } finally {
    if (owned) roots.close();
  }
}

function assertPayloadIdentity(binding, data) {
  assertActiveStorage(binding);
  if (binding.record.data !== data) {
    throw new ManagedFault('InvalidOperationException', 'Managed payload changed during a host storage operation');
  }
}

function assertCurrentPayload(binding, data) {
  assertPayloadIdentity(binding, data);
  const length = data.length;
  assertPayloadIdentity(binding, data);
  if (length !== binding.length) {
    throw new ManagedFault('InvalidOperationException', 'Managed payload changed during a host storage operation');
  }
}

function assertStorageAfterFailedCallback(binding, data, roots) {
  assertPayloadIdentity(binding, data);
  let length;
  let readable = false;
  try {
    length = data.length;
    readable = true;
  } catch (error) {
    roots.heap.events.observerError('SF-GC-EVENT-001', error?.message ?? error);
  }
  // The length getter may itself replace or release storage, including before
  // throwing. Only these current-state checks can supersede the primary error.
  assertPayloadIdentity(binding, data);
  if (readable && length !== binding.length) {
    throw new ManagedFault('InvalidOperationException', 'Managed payload changed during a host storage operation');
  }
}

/** A managed write updates the exact public array or instrumentation proxy and its physical mirror. */
export function writePublicSlot(binding, data, index, value, roots = null) {
  assertCurrentPayload(binding, data);
  if (binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen managed data is read-only');
  storageRange(binding, index, 1);
  if (data === binding.view) return writeStoredSlot(binding, index, value);
  return publishHostSlot(binding, data, index, {value, raw: false}, roots);
}

export function readPublicSlot(binding, index, roots = null) {
  if (binding.record.data === binding.view) return readStoredSlot(binding, index);
  const owned = roots === null;
  roots ??= new HostPayloadRoots(binding.owner.heap);
  const pending = roots.pending;
  try {
    if (owned) roots.retain(binding.reference);
    const data = publicPayload(binding, roots);
    const value = data[index];
    roots.pending = value;
    roots.validate(value);
    assertCurrentPayload(binding, data);
    if (!binding.codec) return value;
    synchronizeStoredSlot(binding, index, value);
    return readStoredSlot(binding, index);
  } finally {
    roots.pending = pending;
    if (owned) roots.close();
  }
}

function synchronizeStoredSlot(binding, index, value) {
  if (binding.codec?.synchronize) {
    binding.codec.synchronize(binding.arena.view, binding.block.offset + index * binding.codec.size, value);
  } else writeStoredSlot(binding, index, value);
}

function managedProjection(binding, value, roots) {
  if (!binding.codec) return value;
  // Cold instrumentation observes the same narrowed scalar as a canonical view.
  // Reuse one operation-owned scratch word without writing the real store early.
  roots.storageView ??= new DataView(new ArrayBuffer(8));
  binding.codec.write(roots.storageView, 0, value);
  return binding.codec.read(roots.storageView, 0);
}

function reconcileHostSlot(binding, data, index, request, roots) {
  assertCurrentPayload(binding, data);
  const actual = data[index];
  const pending = roots.pending;
  roots.pending = actual;
  try {
    if (actual === request.value) roots.validate(actual);
    else roots.retain(actual);
    binding.codec?.validate(actual);
    assertCurrentPayload(binding, data);
    // A setter can compact before forwarding, replacing the physical mirror
    // with its old public value. Reconcile the observed result after callbacks.
    if (request.failed || request.raw) synchronizeStoredSlot(binding, index, actual);
    else writeStoredSlot(binding, index, actual);
    if (request.raw && !request.failed) {
      if (!!actual !== binding.codec.toManaged(request.value)) {
        throw new ManagedFault('InvalidOperationException', 'Host payload rejected the managed storage value');
      }
      binding.codec.writeRaw(binding.arena.view, binding.block.offset + index * binding.codec.size, request.value);
    }
  } finally {
    roots.pending = pending;
  }
}

function publishHostSlot(binding, data, index, request, roots) {
  const owned = roots === null;
  roots ??= new HostPayloadRoots(binding.owner.heap);
  try {
    if (owned) {
      roots.retain(binding.reference);
      roots.retain(request.value);
    }
    request.failed = false;
    let failure;
    const managed = request.raw ? binding.codec.toManaged(request.value) : managedProjection(binding, request.value, roots);
    try {
      data[index] = managed;
    } catch (error) {
      request.failed = true;
      failure = error;
      roots.retain(error);
    }
    try {
      reconcileHostSlot(binding, data, index, request, roots);
    } catch (error) {
      // Lifetime or payload-identity faults invalidate further storage access.
      // A secondary host getter must not hide the original setter exception.
      if (!request.failed) throw error;
      assertStorageAfterFailedCallback(binding, data, roots);
      roots.heap.events.observerError('SF-GC-EVENT-001', error?.message ?? error);
    }
    if (request.failed) throw failure;
  } finally {
    if (owned) roots.close();
  }
}

function publishRawSlot(binding, data, index, value, roots = null) {
  assertCurrentPayload(binding, data);
  publishHostSlot(binding, data, index, {value, raw: true}, roots);
}

/** CLI stores validate before publication and preserve instrumentation of the public Boolean projection. */
export function writeRawSlot(binding, index, value, data, roots = null) {
  assertActiveStorage(binding);
  if (binding.readOnly) throw new ManagedFault('InvalidOperationException', 'Frozen managed data is read-only');
  storageRange(binding, index, 1);
  binding.codec.validateRaw(value);
  if (data === undefined) data = publicPayload(binding);
  assertCurrentPayload(binding, data);
  if (data !== binding.view) publishRawSlot(binding, data, index, value, roots);
  else binding.codec.writeRaw(binding.arena.view, binding.block.offset + index * binding.codec.size, value);
}

function storageRange(binding, start, count) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || start > binding.length - count) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Backing storage range is outside its bounds');
  }
}

/** Cold synchronization before byte access, relocation or capture; ordinary views do no work. */
export function synchronizePayload(binding, start = 0, count = binding.length) {
  if (binding.record.data === binding.view) return;
  const roots = new HostPayloadRoots(binding.owner.heap);
  try {
    roots.retain(binding.reference);
    synchronizeHostPayload(binding, start, count, roots);
  } finally {
    roots.close();
  }
}

function synchronizeHostPayload(binding, start, count, roots) {
  const data = publicPayload(binding, roots);
  storageRange(binding, start, count);
  const values = [];
  roots.values = values;
  for (let index = 0; index < count; index++) {
    const value = data[start + index];
    roots.pending = value;
    roots.validate(value);
    binding.codec?.validate(value);
    values.push(value);
    roots.pending = null;
  }
  assertCurrentPayload(binding, data);
  for (let index = 0; index < count; index++) synchronizeStoredSlot(binding, start + index, values[index]);
}

/** Publish a physical byte write back through an existing public replacement, including host hooks. */
export function publishStoredRange(binding, start, count) {
  if (binding.record.data === binding.view) return;
  const roots = new HostPayloadRoots(binding.owner.heap);
  try {
    roots.retain(binding.reference);
    publishHostRange(binding, start, count, roots);
  } finally {
    roots.close();
  }
}

function publishHostRange(binding, start, count, roots) {
  storageRange(binding, start, count);
  const values = new Array(count);
  roots.values = values;
  const raw = !!binding.codec?.readRaw;
  for (let index = 0; index < count; index++) {
    values[index] = raw ? binding.codec.readRaw(binding.arena.view, binding.block.offset + (start + index) * binding.codec.size)
      : readStoredSlot(binding, start + index);
    roots.validate(values[index]);
  }
  const data = publicPayload(binding, roots);
  for (let index = 0; index < count; index++) {
    if (raw) publishRawSlot(binding, data, start + index, values[index], roots);
    else writePublicSlot(binding, data, start + index, values[index], roots);
  }
}
