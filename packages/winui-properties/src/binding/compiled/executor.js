import {PropertyFault} from '../../property/values.js';
import {validateCompiledBindingDescriptor} from './descriptor.js';
import {CompiledExpressionTracker, disposeSubscriptions} from './tracker.js';

/** Compiler-owned token descriptors execute independently of the XAML/string-path binder. */
export class CompiledBindings {
  constructor({descriptors, source, target, services, maxBindings = 10000, maxUpdates = 128, phases = null, contextValues = {}}) {
    if (![maxBindings, maxUpdates].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000000)) {
      throw new RangeError('Invalid compiled binding budgets');
    }
    if (!Array.isArray(descriptors) || descriptors.length > maxBindings) throw new RangeError('Compiled binding count exceeded');
    if (typeof source !== 'function' || typeof target !== 'function' || typeof services?.get !== 'function') {
      throw new TypeError('Compiled bindings require source/target and token accessor services');
    }
    this.source = source;
    this.target = target;
    this.services = services;
    this.maxBindings = maxBindings;
    this.maxUpdates = maxUpdates;
    this.phases = phases;
    this.contextValues = Object.freeze({...contextValues});
    this.phaseDisposers = [];
    this.tracking = false;
    this.disposed = false;
    this.restoring = false;
    this.trackers = descriptors.map(descriptor => new CompiledExpressionTracker(validateCompiledBindingDescriptor(descriptor), this));
    if (this.trackers.some(tracker => tracker.descriptor.phase > 0) && !phases) {
      throw new PropertyFault('NotSupportedException', 'Phased compiled bindings require an injected frame scheduler');
    }
  }

  Initialize() {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Compiled bindings are disposed');
    if (this.tracking) return;
    this.tracking = true;
    try {
      for (const tracker of this.trackers) {
        const phase = tracker.descriptor.phase ?? 0;
        if (phase) this.phaseDisposers.push(this.phases.enqueue(phase, () => tracker.initialize()));
        else tracker.initialize();
      }
    } catch (error) {
      try { this.StopTracking(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Compiled binding initialization failed'); }
      throw error;
    }
  }

  Update() {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Compiled bindings are disposed');
    for (const tracker of this.trackers) {
      if (this.tracking && tracker.descriptor.phase > 0 && !tracker.initialized) continue;
      tracker.update();
    }
  }

  StopTracking() {
    this.tracking = false;
    const disposers = [...this.phaseDisposers, ...this.trackers.map(tracker => () => tracker.stop())];
    this.phaseDisposers = [];
    disposeSubscriptions(disposers);
    if (!this.restoring) this.services?.stateChanged?.();
  }

  Dispose() {
    if (this.disposed) return;
    const changed = this.services?.stateChanged;
    try { this.StopTracking(); }
    finally {
      this.disposed = true;
      this.trackers.length = 0;
      this.services = null;
      this.source = null;
      this.target = null;
      this.contextValues = Object.freeze({});
      if (!this.restoring) changed?.();
    }
  }

  dispose() { return this.Dispose(); }

  /** Remove a controller created after a checkpoint without replaying managed event accessors or callbacks. */
  disposeForRestore() {
    const services = this.services;
    services?.beginRestore?.();
    this.restoring = true;
    try { this.Dispose(); }
    finally { this.restoring = false; services?.endRestore?.(); }
  }

  *retainedValues() {
    yield* Object.values(this.contextValues);
    for (const tracker of this.trackers) yield* tracker.retainedValues();
  }

  snapshot() {
    return {version: 1, tracking: this.tracking, disposed: this.disposed, source: this.source, target: this.target, services: this.services,
      phases: this.phases, phaseState: this.phases?.snapshot(), phaseDisposers: [...this.phaseDisposers], contextValues: this.contextValues,
      trackers: this.trackers.map(tracker => ({tracker, state: tracker.snapshot()}))};
  }

  /** Reinstall saved observers after heap/property restoration, without evaluating any expression. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.trackers) || snapshot.trackers.length > this.maxBindings
      || snapshot.trackers.some(entry => !(entry.tracker instanceof CompiledExpressionTracker) || entry.tracker.controller !== this)) {
      throw new TypeError('Invalid compiled binding snapshot');
    }
    const services = snapshot.services;
    services?.beginRestore?.();
    this.restoring = true;
    try {
      this.StopTracking();
      this.services = services;
      this.source = snapshot.source;
      this.target = snapshot.target;
      this.tracking = snapshot.tracking;
      this.disposed = snapshot.disposed;
      this.phases = snapshot.phases;
      this.contextValues = snapshot.contextValues;
      this.trackers = snapshot.trackers.map(entry => entry.tracker);
      for (const entry of snapshot.trackers) entry.tracker.restore(entry.state);
      if (snapshot.phaseState) this.phases.restore(snapshot.phaseState);
      this.phaseDisposers = [...snapshot.phaseDisposers];
    } finally { this.restoring = false; services?.endRestore?.(); }
  }
}

export function createCompiledBindings(options) { return new CompiledBindings(options); }
