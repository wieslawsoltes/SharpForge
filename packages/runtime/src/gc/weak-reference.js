import {HostHandleKind} from './host-handles.js';

/** Managed weak identity, independent of host WeakRef/FinalizationRegistry scheduling. */
export class ManagedWeakReference {
  constructor(heapOrLifetime, target = null, {trackResurrection = false, owner = null, managedOwner = null} = {}) {
    this.lifetime = heapOrLifetime.lifetime ?? heapOrLifetime;
    this.trackResurrection = !!trackResurrection;
    this.handle = this.lifetime.createHandle(target, {
      kind: this.trackResurrection ? HostHandleKind.WeakLong : HostHandleKind.WeakShort, owner, managedOwner
    });
    Object.freeze(this);
  }

  get target() { return this.lifetime.getHandle(this.handle); }
  set target(value) { this.lifetime.setHandle(this.handle, value); }
  get isAlive() { return this.target !== null; }

  tryGetTarget() {
    const target = this.target;
    return {success: target !== null, target};
  }

  setTarget(value) { this.target = value; }
  dispose() { return this.lifetime.releaseHandle(this.handle); }
  [Symbol.dispose]() { this.dispose(); }
}
