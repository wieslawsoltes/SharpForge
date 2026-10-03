import {ManagedFault} from './fault.js';
import {lifetimeFault, noteLifetimeMutation, liveReference} from './lifetime-state.js';

function resourceBytes(resource, specified) {
  const buffer = resource instanceof ArrayBuffer || ArrayBuffer.isView(resource) ||
    typeof SharedArrayBuffer !== 'undefined' && resource instanceof SharedArrayBuffer;
  const value = specified ?? (buffer ? resource.byteLength : 0);
  if (typeof value !== 'bigint' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Native resource bytes must be an exact nonnegative Int64');
  }
  const bytes = BigInt(value);
  if (bytes < 0n || bytes > (1n << 63n) - 1n) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Native resource bytes must be an exact nonnegative Int64');
  }
  return bytes;
}

/** Deterministic host-resource accounting; release is exactly once, including shutdown. */
export class HostResourceTable {
  constructor(lifetime) {
    this.lifetime = lifetime;
    this.owner = Object.freeze({});
    this.entries = new Map();
    this.nextId = 1;
    this.revision = 0;
  }

  register(resource, release, {owner = null, ownsHandle = true, invalid = false, reference = null,
    isInvalid = null, managedRelease = false, memoryPressureBytes = undefined} = {}) {
    this.lifetime.requireOpen();
    if (typeof release !== 'function') throw new TypeError('A synchronous host-resource release hook is required');
    if (reference !== null) this.lifetime.heap.get(reference);
    const id = this.nextId;
    if (!Number.isSafeInteger(id)) throw lifetimeFault('Host resource identity exhausted');
    const pressureBytes = resourceBytes(resource, memoryPressureBytes);
    const pressureLease = pressureBytes > 0n ? this.lifetime.heap.withRoots([reference],
      () => this.lifetime.heap.pressure.lease(pressureBytes)) : null;
    this.nextId++;
    const token = Object.freeze({id, owner: this.owner});
    this.entries.set(id, {token, resource, release, ownerTag: owner, ownsHandle: !!ownsHandle,
      invalid: !!invalid, invalidQuery: isInvalid, managedRelease: !!managedRelease, reference,
      closed: false, closeRequested: false, borrows: 0, releaseError: null, pressureBytes, pressureLease});
    this.revision++;
    return token;
  }

  entry(token) {
    const entry = token?.owner === this.owner ? this.entries.get(token.id) : null;
    if (!entry) throw lifetimeFault('The SafeHandle is invalid or belongs to another heap');
    return entry;
  }

  addRef(token) {
    const entry = this.entry(token);
    if (entry.closeRequested || entry.closed) throw new ManagedFault('ObjectDisposedException', 'The SafeHandle is closed');
    if (!Number.isSafeInteger(entry.borrows + 1)) throw lifetimeFault('SafeHandle borrow count exhausted');
    entry.borrows++;
    return true;
  }

  isInvalid(token) {
    const entry = this.entry(token);
    return entry.invalid || (entry.invalidQuery ? !!entry.invalidQuery(entry.resource) : false);
  }

  releaseRef(token) {
    const entry = this.entry(token);
    if (entry.borrows === 0) throw lifetimeFault('DangerousRelease has no matching DangerousAddRef');
    entry.borrows--;
    if (entry.closeRequested && entry.borrows === 0) this.releaseEntry(entry);
  }

  close(token, {force = false} = {}) {
    const entry = this.entry(token);
    if (entry.closed) return false;
    entry.closeRequested = true;
    if (force || entry.borrows === 0) this.releaseEntry(entry);
    return true;
  }

  releaseEntry(entry) {
    if (entry.closed) return;
    entry.closed = true;
    this.revision++;
    if (liveReference(this.lifetime.heap, entry.reference)) this.lifetime.suppressFinalize(entry.reference);
    try {
      if (!entry.ownsHandle || this.isInvalid(entry.token)) return;
      const released = entry.release(entry.resource);
      if (released?.then) throw new ManagedFault('NotSupportedException', 'Host resource release must complete synchronously');
      if (released === false) throw lifetimeFault('The host-resource release hook reported failure');
    } catch (error) {
      entry.releaseError = error;
      throw error;
    } finally {
      entry.pressureLease?.dispose();
      entry.pressureLease = null;
      noteLifetimeMutation(this.lifetime.heap);
    }
  }

  releaseOwner(owner) {
    return this.releaseWhere(entry => entry.ownerTag === owner);
  }

  releaseAll(options) { return this.releaseWhere(() => true, options); }

  releaseWhere(predicate, {skipManaged = false} = {}) {
    let released = 0;
    const errors = [];
    for (const entry of this.entries.values()) {
      if (entry.closed || !predicate(entry)) continue;
      if (skipManaged && entry.managedRelease) {
        entry.closed = true;
        entry.closeRequested = true;
        this.revision++;
        entry.pressureLease?.dispose();
        entry.pressureLease = null;
        continue;
      }
      try {
        this.close(entry.token, {force: true});
        released++;
      } catch (error) { errors.push(error); }
    }
    return {released, errors};
  }

  report() {
    return [...this.entries.values()].filter(entry => !entry.closed).map(entry => ({id: entry.token.id,
      owner: entry.ownerTag, borrows: entry.borrows, closeRequested: entry.closeRequested,
      reference: entry.reference, memoryPressureBytes: entry.pressureBytes}));
  }

  snapshot() {
    return {owner: this.owner, revision: this.revision, nextId: this.nextId,
      entries: [...this.entries].map(([id, entry]) => [id, {...entry}])};
  }

  assertRestorable(state) {
    if (state.owner !== this.owner || state.revision !== this.revision) {
      throw lifetimeFault('Cannot restore across host-resource acquisition or release');
    }
  }

  restore(state) {
    this.assertRestorable(state);
    this.nextId = Math.max(this.nextId, state.nextId);
    this.entries = new Map(state.entries.map(([id, entry]) => [id, {...entry}]));
  }
}

/** SafeHandle-style critical finalization and balanced temporary host-resource borrows. */
export class ManagedSafeHandle {
  constructor(heapOrLifetime, resource, release, options = {}) {
    this.lifetime = heapOrLifetime.lifetime ?? heapOrLifetime;
    this.token = this.lifetime.resources.register(resource, release, options);
    if (options.reference) this.lifetime.bindSafeHandle(options.reference, this.token);
    Object.freeze(this);
  }

  get isClosed() {
    const entry = this.lifetime.resources.entry(this.token);
    return entry.closed || entry.closeRequested;
  }
  get isInvalid() { return this.lifetime.resources.isInvalid(this.token); }
  dangerousGetHandle() { return this.lifetime.resources.entry(this.token).resource; }
  dangerousAddRef() { return this.lifetime.resources.addRef(this.token); }
  dangerousRelease() { this.lifetime.resources.releaseRef(this.token); }
  close() { return this.lifetime.resources.close(this.token); }
  dispose() { return this.close(); }
  [Symbol.dispose]() { this.dispose(); }

  setHandleAsInvalid() {
    const entry = this.lifetime.resources.entry(this.token);
    entry.invalid = true;
    this.close();
  }
}
