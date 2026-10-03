import {ManagedFault} from './fault.js';
import {positiveBudget, lifetimeFault} from './lifetime-state.js';

function failure(error, reference) {
  const fault = error instanceof ManagedFault ? error :
    new ManagedFault('UnhandledFinalizerException', `Unhandled finalizer exception: ${error?.message ?? String(error)}`, reference);
  fault.fatal = true;
  fault.finalizerReference = reference;
  return fault;
}

function iteratorRunner(iterator) {
  return {
    step(budget) {
      let instructions = 0;
      while (instructions < budget) {
        const result = iterator.next();
        const cost = result.done ? 1 : result.value?.instructions ?? 1;
        if (!Number.isSafeInteger(cost) || cost < 1) throw lifetimeFault('Finalizer yielded an invalid instruction count');
        instructions += cost;
        if (result.done) return {done: true, instructions};
      }
      return {done: false, instructions};
    }
  };
}

/** A dedicated cooperative context; trusted host callbacks must themselves be bounded. */
export class FinalizerContext {
  constructor(registry, {maxFinalizerInstructions = 100000, finalizerSliceBudget = 128} = {}) {
    this.registry = registry;
    this.instructionLimit = positiveBudget(maxFinalizerInstructions, 'Finalizer instruction limit');
    this.sliceBudget = positiveBudget(finalizerSliceBudget, 'Finalizer slice budget');
    this.active = null;
    this.fault = null;
    this.stopped = false;
    this.executing = false;
    this.totalInstructions = 0;
  }

  createRunner(entry) {
    const lifetime = this.registry.lifetime;
    let result;
    if (typeof entry.callback === 'function') {
      result = entry.callback(entry.reference, {heap: lifetime.heap, lifetime, context: this});
    } else {
      if (typeof lifetime.finalizerExecutor !== 'function') {
        throw new ManagedFault('NotSupportedException', 'The runtime has no managed finalizer executor');
      }
      result = lifetime.finalizerExecutor(entry.reference, entry.callback, this);
    }
    if (result?.then) throw new ManagedFault('NotSupportedException', 'Finalizers cannot return a host Promise');
    if (typeof result?.next === 'function') return iteratorRunner(result);
    if (typeof result?.step === 'function') return result;
    if (typeof entry.callback !== 'function' && result !== undefined && result !== null) {
      throw lifetimeFault('A managed finalizer executor must return void or a cooperative runner');
    }
    // Host callbacks are void boundaries: expression bodies such as log.push(value) have incidental return values.
    return null;
  }

  result(completed, instructions) {
    const pending = this.registry.pendingCount;
    const status = this.stopped ? 'stopped' : this.fault ? 'faulted' : pending ? 'yielded' : 'idle';
    return {completed, instructions, pending, status, fault: this.fault};
  }

  /** Execute at most budget instructions; finalizer faults terminate this context permanently. */
  runSlice({budget = this.sliceBudget, maxInstructionsPerFinalizer = this.instructionLimit, signal = null} = {}) {
    positiveBudget(budget, 'Finalizer slice budget');
    positiveBudget(maxInstructionsPerFinalizer, 'Finalizer instruction limit');
    if (this.stopped || this.fault || this.executing || this.registry.pendingCount === 0) return this.result(0, 0);
    let completed = 0;
    let instructions = 0;
    this.executing = true;
    try {
      this.registry.heap.events?.finalizersBegin({pending: this.registry.pendingCount, instructionBudget: budget});
      while (instructions < budget && !this.stopped) {
        signal?.throwIfAborted();
        if (!this.active) {
          const entry = this.registry.dequeue();
          if (!entry) break;
          this.active = {entry, runner: null, initialized: false, instructions: 0};
        }
        const active = this.active;
        const remaining = maxInstructionsPerFinalizer - active.instructions;
        if (remaining <= 0) throw new ManagedFault('ExecutionLimitException', 'Finalizer instruction budget exhausted');
        const allowance = Math.min(budget - instructions, remaining);
        const step = this.advance(active, allowance);
        if (!Number.isSafeInteger(step.instructions) || step.instructions < 1 || step.instructions > allowance) {
          throw lifetimeFault('Finalizer executor exceeded its cooperative instruction allowance');
        }
        active.instructions += step.instructions;
        instructions += step.instructions;
        this.totalInstructions += step.instructions;
        if (step.done) {
          this.registry.complete(active.entry);
          this.active = null;
          completed++;
        } else if (active.instructions >= maxInstructionsPerFinalizer) {
          throw new ManagedFault('ExecutionLimitException', 'Finalizer instruction budget exhausted');
        }
      }
    } catch (error) {
      this.fault = failure(error, this.active?.entry.reference ?? null);
      this.registry.lifetime.onFinalizerFault?.(this.fault);
    } finally {
      this.registry.heap.events?.finalizersEnd({completed, instructions, pending: this.registry.pendingCount,
        status: this.stopped ? 'stopped' : this.fault ? 'faulted' : this.registry.pendingCount ? 'yielded' : 'idle'});
      this.executing = false;
    }
    return this.result(completed, instructions);
  }

  advance(active, allowance) {
    if (!active.initialized) {
      active.initialized = true;
      active.runner = this.createRunner(active.entry);
      return {done: active.runner === null, instructions: 1};
    }
    return active.runner.step(allowance);
  }

  visitRoots(visitor) {
    if (this.active) {
      visitor(this.active.entry.reference, 'finalizer', 'Running finalizer');
      this.active.runner?.visitRoots?.(visitor);
    }
  }

  stop() {
    this.stopped = true;
    this.active = null;
  }

  snapshot() {
    const active = this.active;
    if (this.executing) throw lifetimeFault('Cannot snapshot while a finalizer instruction is executing');
    if (active?.runner && (typeof active.runner.snapshot !== 'function' || typeof active.runner.restore !== 'function')) {
      throw lifetimeFault('The active host finalizer cannot be snapshotted cooperatively');
    }
    return {active: active ? {reference: active.entry.reference, runner: active.runner,
      runnerState: active.runner?.snapshot(), initialized: active.initialized, instructions: active.instructions} : null,
    fault: this.fault, stopped: this.stopped, totalInstructions: this.totalInstructions};
  }

  restore(state) {
    this.fault = state.fault;
    this.stopped = state.stopped;
    this.totalInstructions = state.totalInstructions;
    this.executing = false;
    const active = state.active;
    this.active = active ? {entry: this.registry.requireEntry(active.reference), runner: active.runner,
      initialized: active.initialized, instructions: active.instructions} : null;
    active?.runner?.restore(active.runnerState);
  }
}
