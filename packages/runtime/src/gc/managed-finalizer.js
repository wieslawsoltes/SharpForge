import {copyExecution, copyFrames} from '../snapshot.js';
import {ManagedFault} from './fault.js';
import {visitExecutionRoots, RootCategory} from './roots.js';
import {verifyManagedEntry} from './verified-entry.js';

const fields = ['frames', 'stack', 'currentPoint', 'pendingFault', 'fault', 'returnValue', 'exitCode', 'sourcePause', 'state'];

function capture(vm) {
  const state = {};
  for (const field of fields) if (Object.hasOwn(vm, field)) state[field] = vm[field];
  return state;
}

function apply(vm, state) {
  for (const field of fields) {
    if (Object.hasOwn(state, field)) vm[field] = state[field];
    else delete vm[field];
  }
}

/** Finalizer lookup is indexed once per code generation, then O(1) per allocated type. */
export class ManagedFinalizerResolver {
  constructor(vm) {
    this.vm = vm;
    this.code = null;
    this.methods = new Map();
    this.cache = new Map();
  }

  rebuild() {
    this.code = this.vm.inspector ?? this.vm.image;
    this.methods.clear();
    this.cache.clear();
    const methods = this.vm.inspector ? this.vm.inspector.methods.values() : this.vm.image.methods;
    for (const item of methods) {
      if (item.name !== 'Finalize') continue;
      const method = this.vm.inspector ? this.vm.inspector.getMethod(item.token) : item;
      if (!(method.signature?.isStatic ?? method.isStatic) && (method.signature?.parameters ?? method.parameters ?? []).length === 0) {
        this.methods.set(method.owner, {engine: this.vm.inspector ? 'cil' : 'source', method: method.token ?? method.id});
      }
    }
  }

  resolve(reference, record) {
    if (record.kind !== 'object') return null;
    if (this.code !== (this.vm.inspector ?? this.vm.image)) this.rebuild();
    if (this.cache.has(record.methodTable)) return this.cache.get(record.methodTable);
    let callback = null;
    let critical = false;
    for (let table = record.methodTable; table; table = table.base) {
      callback ??= this.methods.get(table.name) ?? null;
      critical ||= table.flags?.criticalFinalizer === true || table.name === 'System.Runtime.ConstrainedExecution.CriticalFinalizerObject' ||
        table.name === 'System.Runtime.InteropServices.SafeHandle';
    }
    const result = callback ? {callback, critical} : null;
    this.cache.set(record.methodTable, result);
    return result;
  }
}

/** A finalizer has its own rooted frames; each slice restores the interrupted VM atomically. */
export class ManagedFinalizerRunner {
  constructor(runtime, reference, descriptor) {
    this.runtime = runtime;
    this.reference = reference;
    this.descriptor = descriptor;
    this.execution = null;
    this.interrupted = null;
    this.done = false;
    runtime.finalizerRunners.add(this);
  }

  step(instructionBudget) {
    if (this.done) return {done: true, instructions: 0};
    const {vm} = this.runtime;
    if (!this.execution) verifyManagedEntry(vm, this.descriptor.method);
    const saved = capture(vm);
    this.interrupted = saved;
    const suppressed = vm.scheduler.suppressed;
    const callbacks = {onException: vm.onException, onWrite: vm.onWrite};
    const before = vm.instructions;
    this.runtime.executingFinalizer = true;
    vm.scheduler.suppressed = true;
    vm.onException = null;
    vm.onWrite = null;
    try {
      if (this.execution) apply(vm, this.execution);
      else {
        apply(vm, {frames: [], ...(vm.image ? {stack: []} : {}), state: 'running', returnValue: null,
          fault: null, pendingFault: null, exitCode: 0, currentPoint: null, sourcePause: false});
        vm.call(this.descriptor.method, [this.reference]);
      }
      vm.runSlice({instructionBudget, timeBudgetMs: Infinity});
      if (vm.state === 'waiting') throw new ManagedFault('InvalidOperationException', 'Finalizers cannot await external operations');
      if (vm.state === 'faulted') throw vm.fault;
      this.execution = capture(vm);
      this.done = vm.frames.length === 0;
      return {done: this.done, instructions: vm.instructions - before};
    } finally {
      if (!this.done) this.execution = capture(vm);
      apply(vm, saved);
      this.interrupted = null;
      vm.scheduler.suppressed = suppressed;
      Object.assign(vm, callbacks);
      this.runtime.executingFinalizer = false;
      if (this.done) this.runtime.finalizerRunners.delete(this);
    }
  }

  visitRoots(visitor) {
    if (this.interrupted) visitExecutionRoots(this.interrupted, visitor, RootCategory.Stack);
    if (this.execution && !this.done) visitExecutionRoots(this.execution, visitor, RootCategory.Finalizer);
  }

  /** Discarded contexts release runtime tracking; restoring saved execution reattaches the same runner. */
  detach() {
    this.runtime.finalizerRunners.delete(this);
  }

  snapshot() {
    if (!this.execution) return {execution: null, done: this.done};
    const memo = new Map();
    return {execution: {...copyExecution(this.execution, memo), frames: copyFrames(this.execution.frames, memo)}, done: this.done};
  }

  restore(snapshot) {
    const memo = new Map();
    this.execution = snapshot.execution ?
      {...copyExecution(snapshot.execution, memo), frames: copyFrames(snapshot.execution.frames, memo)} : null;
    this.done = snapshot.done;
    if (this.done) this.runtime.finalizerRunners.delete(this);
    else this.runtime.finalizerRunners.add(this);
  }
}
