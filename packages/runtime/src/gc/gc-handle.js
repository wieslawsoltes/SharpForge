import {HostHandleKind} from './host-handles.js';
import {lifetimeFault} from './lifetime-state.js';

export const GCHandleType = Object.freeze({Weak: 0, WeakTrackResurrection: 1, Normal: 2, Pinned: 3});
const kinds = [HostHandleKind.WeakShort, HostHandleKind.WeakLong, HostHandleKind.Strong, HostHandleKind.Pinned];

/** Typed managed handle. Free is deliberately stricter than idempotent host lease release. */
export class ManagedGCHandle {
  constructor(heapOrLifetime, handle) {
    this.lifetime = heapOrLifetime.lifetime ?? heapOrLifetime;
    this.handle = handle;
    Object.freeze(this);
  }

  static alloc(heapOrLifetime, value, type = GCHandleType.Normal, options = {}) {
    if (!Number.isInteger(type) || !kinds[type]) throw new RangeError('Unknown GCHandleType');
    const lifetime = heapOrLifetime.lifetime ?? heapOrLifetime;
    return new ManagedGCHandle(lifetime, lifetime.createHandle(value, {...options, kind: kinds[type]}));
  }

  static fromIntPtr(heapOrLifetime, token) {
    const lifetime = heapOrLifetime.lifetime ?? heapOrLifetime;
    if (token?.kind !== 'gc-handle-token' || token.owner !== lifetime.heap.handleOwner || typeof token.value !== 'bigint' ||
        token.value < 1n || token.value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw lifetimeFault('The GCHandle token is invalid or belongs to another heap');
    }
    const handle = Object.freeze({id: Number(token.value), owner: token.owner});
    lifetime.hostHandles.entry(handle, true);
    return new ManagedGCHandle(lifetime, handle);
  }

  get isAllocated() { return this.lifetime.hostHandles.entry(this.handle) !== null; }

  get target() {
    this.lifetime.hostHandles.entry(this.handle, true);
    return this.lifetime.getHandle(this.handle);
  }

  set target(value) { this.lifetime.setHandle(this.handle, value); }

  free() {
    if (!this.lifetime.releaseHandle(this.handle)) throw lifetimeFault('The GCHandle was already freed or is invalid');
  }

  toIntPtr() {
    const entry = this.lifetime.hostHandles.entry(this.handle, true);
    if (entry.pointer) return entry.pointer;
    const value = BigInt(this.handle.id);
    entry.pointer = Object.freeze({kind: 'gc-handle-token', owner: this.handle.owner, value, valueOf: () => value});
    return entry.pointer;
  }

  addrOfPinnedObject() {
    const entry = this.lifetime.hostHandles.entry(this.handle, true);
    if (entry.kind !== HostHandleKind.Pinned) throw lifetimeFault('AddrOfPinnedObject requires a pinned GCHandle');
    return entry.value === null ? 0n : this.lifetime.addressOfPinnedObject(entry.value);
  }

  dispose() { this.free(); }
  [Symbol.dispose]() { this.dispose(); }
}
