import {ManagedFault} from './fault.js';
import {HostPayloadRoots} from './host-payload-roots.js';
import {isReference, sameReference} from './reference.js';
import {synchronizePayload, publishStoredRange} from './spatial-payload.js';

const ByteArray = Uint8Array;
const typedArray = Object.getPrototypeOf(ByteArray.prototype);
const byteTag = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag).get;
const byteLength = Object.getOwnPropertyDescriptor(typedArray, 'length').get;
const byteBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
const setBytes = ByteArray.prototype.set;

function memoryFault(message) {
  return new ManagedFault('InvalidAddressException', message);
}

function integer(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an exact integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function payload(heap, reference) {
  const record = heap.get(reference);
  const binding = heap.spaces.getBinding(record);
  const string = record.kind === 'string';
  if (!string && (record.kind !== 'array' || !binding.codec || binding.arena.hostBacked)) {
    throw new ManagedFault('NotSupportedException', 'Memory views require a primitive/enum array or a UTF-16 string');
  }
  return {record, binding, string, byteLength: record.storage.byteLength,
    readOnly: string || binding.readOnly || record.space === 'frozen'};
}

function elementRange(binding, byteOffset, byteLength) {
  const start = Math.floor(byteOffset / binding.codec.size);
  return {start, count: Math.ceil((byteOffset + byteLength) / binding.codec.size) - start};
}

/** Capture branded byte storage without instance getters, iterators, subarray or species callbacks. */
function captureBytes(bytes, count, length) {
  const captured = new ByteArray(count);
  setBytes.call(captured, bytes);
  return length === count ? captured : new ByteArray(byteBuffer.call(captured), 0, length);
}

function writePrepared(scope, memoryReference, {entry, offset, count, allowPartial, bytes}) {
  if (scope.entry(memoryReference) !== entry) throw memoryFault('The prepared debugger memory window has expired');
  const roots = new HostPayloadRoots(scope.heap, 'debugger-memory');
  try {
    roots.retain(entry.reference);
    let range = scope.resolve(memoryReference, offset, count, true, allowPartial);
    if (range.length) {
      const elements = elementRange(range.storage.binding, range.byteOffset, range.length);
      synchronizePayload(range.storage.binding, elements.start, elements.count);
      range = scope.resolve(memoryReference, offset, count, true, allowPartial);
      const binding = range.storage.binding;
      setBytes.call(binding.arena.bytes, bytes, binding.block.offset + range.byteOffset);
      try { publishStoredRange(binding, elements.start, elements.count); }
      finally { scope.heap.noteMutation(); }
      scope.resolve(memoryReference, offset, count, true, allowPartial);
    }
    return {offset, bytesWritten: range.length};
  } finally { roots.close(); }
}

/** Bounded debugger payload windows. Host revocation is not undone by managed snapshot replay. */
export class DebuggerMemoryScope {
  constructor(heap, {maxReferences = 128, maxTransferBytes = 65536} = {}) {
    this.heap = heap;
    this.maxReferences = integer(maxReferences, 'Memory reference budget', 1, 4096);
    this.maxTransferBytes = integer(maxTransferBytes, 'Memory transfer budget', 1, 1024 * 1024);
    if (!globalThis.crypto?.randomUUID) throw new ManagedFault('NotSupportedException', 'Opaque debugger identities need crypto.randomUUID');
    this.identity = globalThis.crypto.randomUUID();
    this.nextId = 1;
    this.entries = new Map();
    this.cache = new Map();
    this.opening = new Set();
    this.epoch = 0;
    this.clearing = false;
    this.disposed = false;
  }

  requireOpen() {
    if (this.disposed || this.heap.closed || this.heap.lifetime.closed) {
      throw new ManagedFault('ObjectDisposedException', 'The debugger memory scope has ended');
    }
    if (this.clearing) throw new ManagedFault('InvalidOperationException', 'The debugger memory stop is ending');
  }

  /** True only for existing inspectable payloads; unsupported managed reference slots have no byte representation. */
  supports(value) {
    this.requireOpen();
    if (value?.kind === 'managed-address') {
      value = this.heap.lifetime.addresses.resolve(value, {byteLength: 0}).reference;
    }
    if (!isReference(value)) return false;
    return this.heap.withRoots([value], () => {
      const record = this.heap.get(value);
      if (record.kind === 'string') return true;
      return record.kind === 'array' && !!this.heap.spaces.getBinding(record).codec;
    });
  }

  /** Pin one bounded window; repeated identical requests share one counted lease. No host address is exposed. */
  open(value, {byteOffset = 0, byteLength, readOnly = false} = {}) {
    this.requireOpen();
    if (typeof readOnly !== 'boolean') throw new TypeError('Memory readOnly must be Boolean');
    let reference = value;
    let initialOffset = 0;
    if (value?.kind === 'managed-address') {
      const address = this.heap.lifetime.addresses.resolve(value, {byteLength: 0});
      reference = address.reference;
      initialOffset = address.byteOffset;
    }
    if (!isReference(reference)) throw memoryFault('A live managed reference or an owned pinned address token is required');
    const epoch = this.epoch;
    return this.heap.withRoots([reference], () => this.openWindow(reference, initialOffset, {byteOffset, byteLength, readOnly, epoch}));
  }

  openWindow(reference, initialOffset, {byteOffset, byteLength, readOnly, epoch}) {
    const storage = payload(this.heap, reference);
    this.requireOpen();
    if (this.epoch !== epoch) throw memoryFault('The debugger stop ended while opening a memory view');
    const start = initialOffset + integer(byteOffset, 'Memory byteOffset', 0, storage.byteLength);
    integer(start, 'Memory start', 0, storage.byteLength);
    const length = byteLength ?? storage.byteLength - start;
    integer(length, 'Memory byteLength', 0, storage.byteLength - start);
    const writable = !readOnly && !storage.readOnly;
    const key = `${reference.h}:${reference.g}:${start}:${length}:${writable}`;
    const existing = this.cache.get(key);
    if (existing && this.live(existing)) return existing.description;
    if (existing) this.forget(existing);
    if (this.opening.has(key)) throw new ManagedFault('InvalidOperationException', 'This debugger memory window is already being opened');
    if (this.entries.size + this.opening.size >= this.maxReferences) {
      throw new ManagedFault('ExecutionLimitException', 'Debugger memory reference budget exceeded');
    }
    this.opening.add(key);
    let lease;
    let entry;
    try {
      this.heap.events.deferObservers(() => {
        lease = this.heap.lifetime.pin(reference, {owner: this, reason: 'debugger-memory'});
        this.requireOpen();
        if (this.epoch !== epoch) throw memoryFault('The debugger stop ended while opening a memory view');
        integer(this.nextId, 'Memory reference identity', 1, Number.MAX_SAFE_INTEGER);
        const memoryReference = `sf-memory:${this.identity}:${this.nextId++}`;
        const address = lease.address.add(start);
        const description = Object.freeze({memoryReference, address: address.toString(), byteLength: length, writable});
        entry = {key, reference: lease.reference, lease, address, start, length, writable, description};
        this.entries.set(memoryReference, entry);
        this.cache.set(key, entry);
        // Pin observers can reuse this window. Its entry replaces the reservation
        // before those observers can attempt to acquire another counted lease.
        this.opening.delete(key);
      });
      this.requireOpen();
      if (this.epoch !== epoch) throw memoryFault('The debugger stop ended while opening a memory view');
      if (!this.live(entry)) throw memoryFault('The debugger memory pin lease expired while opening a memory view');
      return entry.description;
    } catch (error) {
      if (entry) this.forget(entry);
      lease?.dispose();
      throw error;
    } finally { this.opening.delete(key); }
  }

  live(entry) {
    return this.heap.lifetime.pinning.leases.get(entry.lease.id)?.lease === entry.lease && !!this.heap.tryGet(entry.reference);
  }

  forget(entry) {
    this.entries.delete(entry.description.memoryReference);
    if (this.cache.get(entry.key) === entry) this.cache.delete(entry.key);
  }

  entry(memoryReference) {
    this.requireOpen();
    if (typeof memoryReference !== 'string' || memoryReference.length > 128) throw memoryFault('Invalid debugger memory reference');
    const entry = this.entries.get(memoryReference);
    if (!entry) throw memoryFault('The debugger memory reference is foreign, released, or expired');
    if (!this.live(entry)) {
      this.forget(entry);
      throw memoryFault('The debugger memory pin lease or allocation generation has expired');
    }
    return entry;
  }

  transferLength(entry, offset, count, write, allowPartial) {
    integer(offset, 'Memory offset', 0, entry.length);
    integer(count, 'Memory transfer count', 0, this.maxTransferBytes);
    if (write && !entry.writable) throw new ManagedFault('InvalidOperationException', 'The memory view is read-only');
    const available = entry.length - offset;
    if (count > available && !allowPartial) throw new RangeError('The write exceeds the debugger memory window');
    return Math.min(count, available);
  }

  /** Prepare one bounded write before history capture, temporary roots or managed payload callbacks. */
  validateWrite(memoryReference, bytes, {offset = 0, allowPartial = false} = {}) {
    if (byteTag.call(bytes) !== 'Uint8Array') throw new TypeError('Memory data must be a Uint8Array');
    if (typeof allowPartial !== 'boolean') throw new TypeError('Memory allowPartial must be Boolean');
    const entry = this.entry(memoryReference);
    const count = byteLength.call(bytes);
    const length = this.transferLength(entry, offset, count, true, allowPartial);
    const request = {entry, offset, count, allowPartial, bytes: captureBytes(bytes, count, length)};
    return Object.freeze({length, execute: () => writePrepared(this, memoryReference, request)});
  }

  resolve(memoryReference, offset, count, write, allowPartial) {
    const entry = this.entry(memoryReference);
    const length = this.transferLength(entry, offset, count, write, allowPartial);
    const storage = payload(this.heap, entry.reference);
    this.entry(memoryReference);
    if (entry.start + entry.length > storage.byteLength) throw memoryFault('The pinned payload window no longer exists');
    if (write && (!entry.writable || storage.readOnly)) throw new ManagedFault('InvalidOperationException', 'The memory view is read-only');
    const address = entry.address.add(offset);
    const resolved = this.heap.lifetime.addresses.resolve(address, {byteLength: length});
    if (!sameReference(resolved.reference, entry.reference) || resolved.byteOffset !== entry.start + offset) {
      throw memoryFault('The virtual address no longer names the pinned payload');
    }
    return {entry, storage, address, byteOffset: entry.start + offset, length, missing: count - length};
  }

  /** Read at most maxTransferBytes; a trailing inaccessible range is reported separately. */
  read(memoryReference, {offset = 0, count} = {}) {
    const entry = this.entry(memoryReference);
    return this.heap.withRoots([entry.reference], () => {
      let range = this.resolve(memoryReference, offset, count, false, true);
      const bytes = new Uint8Array(range.length);
      if (range.storage.string) {
        for (let index = 0; index < bytes.length; index++) {
          const at = range.byteOffset + index;
          bytes[index] = range.storage.record.data.charCodeAt(Math.floor(at / 2)) >>> (at % 2 * 8) & 255;
        }
      } else if (bytes.length) {
        const elements = elementRange(range.storage.binding, range.byteOffset, bytes.length);
        synchronizePayload(range.storage.binding, elements.start, elements.count);
        // Replacement payload accessors may revoke this exact lease or restore the heap.
        range = this.resolve(memoryReference, offset, count, false, true);
        const start = range.storage.binding.block.offset + range.byteOffset;
        bytes.set(range.storage.binding.arena.bytes.subarray(start, start + bytes.length));
      }
      return {address: range.address.toString(), data: bytes, unreadableBytes: range.missing};
    });
  }

  /** Write primitive payload bytes only. Default writes are bounds-checked in full before mutation. */
  write(memoryReference, bytes, options = {}) {
    return this.validateWrite(memoryReference, bytes, options).execute();
  }

  release(memoryReference) {
    const entry = this.entries.get(memoryReference);
    if (!entry) return false;
    this.forget(entry);
    entry.lease.dispose();
    return true;
  }

  clear() {
    if (this.clearing) return;
    this.epoch++;
    this.clearing = true;
    try {
      this.entries.clear();
      this.cache.clear();
      this.heap.lifetime.pinning.releaseOwner(this);
    } finally { this.clearing = false; }
  }

  /** Keep surviving exact leases; discard post-snapshot windows and release restored, host-revoked leases. */
  afterRestore() {
    for (const entry of this.entries.values()) if (this.disposed || !this.live(entry)) this.forget(entry);
    const active = new Set([...this.entries.values()].map(entry => entry.lease));
    for (const [id, pin] of this.heap.lifetime.pinning.leases) {
      if (pin.ownerTag === this && !active.has(pin.lease)) this.heap.lifetime.pinning.releaseId(id);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }
}

/** Reconcile live scopes and disposed scope owners reintroduced by an older same-VM snapshot. */
export function restoreDebuggerScopes(runtime) {
  const scopes = new Set(runtime.debuggerScopes);
  for (const pin of runtime.vm.heap.lifetime.pinning.leases.values()) {
    if (pin.ownerTag instanceof DebuggerMemoryScope && pin.ownerTag.heap === runtime.vm.heap) scopes.add(pin.ownerTag);
  }
  for (const scope of scopes) scope.afterRestore?.();
}
