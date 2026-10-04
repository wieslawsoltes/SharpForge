import {Op} from '@sharpforge/bytecode';
import {RootRegistry, RootCategory, visitRootValue} from './roots.js';
import {ManagedFinalizerRunner, ManagedFinalizerResolver} from './managed-finalizer.js';
import {auditRoots} from './root-audit.js';
import {disposeRuntimeGC} from './runtime-disposal.js';
import {invokeManagedCallback, invokeManagedInstance} from './managed-callback.js';
import {ContextRootBridge, assertContextRootsRestorable} from './context-roots.js';
import {restoreDebuggerScopes} from './debug-memory.js';
import {RuntimeAllocationSite} from './runtime-allocation-site.js';

const callOpcodes = new Set([Op.CALL, Op.BUILTIN, Op.NEWOBJ, Op.DELEGATE, 'call', 'callvirt', 'newobj']);
const returnOpcodes = new Set([Op.RET, 'ret']);

/** Per-VM bridge between materialized execution state and collector services. */
export class RuntimeGC {
  constructor(vm) {
    this.vm = vm;
    vm.heap.currentThreadId = () => vm.scheduler?.current?.id ?? 0;
    this.rootRegistry = new RootRegistry();
    this.contextRoots = new Set();
    this.debuggerScopes = new Set();
    this.debuggerSessions = new Set();
    this.finalizerRunners = new Set();
    this.finalizerResolver = new ManagedFinalizerResolver(vm);
    this.allocationSiteResolver = new RuntimeAllocationSite(vm);
    this.finalizerWaits = new Set();
    this.executingFinalizer = false;
    this.draining = false;
    this.disposed = false;
    if (vm.options.contextRoots) this.registerContextRoots(vm.options.contextRoots);
    this.safepointId = 'managed-runtime';
    this.safepointLease = vm.heap.safepoints?.register(this.safepointId, {
      kind: 'slice-boundary', parked: true, publishRoots: () => {}
    });
    if (vm.heap.lifetime) {
      vm.heap.lifetime.finalizerResolver = (reference, record) => this.finalizerResolver.resolve(reference, record);
      vm.heap.lifetime.finalizerExecutor = (reference, descriptor) => new ManagedFinalizerRunner(this, reference, descriptor);
      vm.heap.lifetime.waitForPendingFinalizersHook = () => this.waitForPendingFinalizers();
      vm.heap.lifetime.dependentValueFactory = (platform, delegate) => key => invokeManagedCallback(vm, delegate, [key]);
      vm.heap.lifetime.managedInstanceInvoker = (reference, method, args = []) => invokeManagedInstance(vm, reference, method, args);
    }
    if (vm.heap.allocationSites) vm.heap.allocationSites.provider = () => this.allocationSite();
  }

  allocationSite() {
    return this.allocationSiteResolver.capture();
  }

  visitRoots(visitor) {
    this.rootRegistry.visitRoots(visitor);
    for (const task of this.finalizerWaits) visitRootValue(task.ref, visitor, RootCategory.Finalizer, 'waiter');
  }

  /** Attach an A04-style explicit root registry; weak entries remain outside managed roots. */
  registerContextRoots(registry) {
    return new ContextRootBridge(this, registry);
  }

  attachPlatform(platform) {
    this.platformResource = this.vm.heap.lifetime?.createSafeHandle(null, () => platform.closeAll(), {owner: 'runtime-platform'});
  }

  keepAlive(value) {
    this.vm.heap.collector.rootBarrier(value);
  }

  safepoint(kind) {
    if (this.disposed) return;
    this.vm.heap.safepoints?.poll(this.safepointId, kind === 'return' ? 'call' : kind, {parked: true});
    this.vm.heap.gcStress?.safepoint(kind);
  }

  beforeInstruction(frame, opcode) {
    this.safepoint('instruction');
    if (callOpcodes.has(opcode)) this.safepoint('call');
  }

  afterInstruction(frame, previousPC, opcode) {
    if (returnOpcodes.has(opcode)) this.safepoint('return');
    else if (this.vm.top === frame && frame.pc <= previousPC) this.safepoint('back-edge');
  }

  beforeSlice() {
    if (this.executingFinalizer || this.disposed) return;
    if (this.vm.state === 'terminated' || this.vm.state === 'faulted') return;
    this.safepoint('slice-boundary');
    this.drainFinalizers();
  }

  afterSlice() {
    if (this.executingFinalizer || this.disposed) return;
    if (this.vm.state !== 'terminated' && this.vm.state !== 'faulted') this.drainFinalizers();
    if (this.vm.options.gcRootAudit) auditRoots(this.vm, {throwOnMiss: true});
  }

  drainFinalizers(budget = 128) {
    if (this.draining || this.executingFinalizer || !this.vm.heap.lifetime) return null;
    this.draining = true;
    try {
      const result = this.vm.heap.lifetime.drainFinalizers({budget});
      if (result.fault) {
        this.vm.fault = result.fault;
        this.vm.state = 'faulted';
      }
      if (!result.pending || result.fault) {
        for (const task of this.finalizerWaits) this.vm.scheduler.complete(task, null, result.fault ?? null);
        this.finalizerWaits.clear();
        this.vm.scheduler.beforeSlice();
      }
      return result;
    } finally {
      this.draining = false;
    }
  }

  waitForPendingFinalizers() {
    if(this.executingFinalizer)return null;
    const result = this.drainFinalizers();
    if (!result?.pending || result.fault) return null;
    const task = this.vm.scheduler.createTask('void', {gcFinalizerWait: true});
    this.finalizerWaits.add(task);
    return this.vm.scheduler.wait(task.ref, {pushResult: !this.vm.inspector, voidResult: true});
  }

  waitForGCNotification(phase, timeout) {
    const current = this.vm.heap.notifications.wait(phase, 0);
    if (current !== 3 || timeout === 0) return current;
    const task = this.vm.platform.hostOperations.start('int',
      signal => this.vm.heap.notifications.waitAsync(phase, {millisecondsTimeout: timeout, signal}),
      value => value, [], 'gc-notification');
    return this.vm.scheduler.wait(task, {pushResult: true});
  }

  hasPendingWork() {
    return this.finalizerWaits.size > 0;
  }

  afterRestore() {
    this.disposed = false;
    restoreDebuggerScopes(this);
    this.finalizerWaits.clear();
    for (const task of this.vm.scheduler.tasks.values()) {
      if (task.gcFinalizerWait && task.status === 'waiting') this.finalizerWaits.add(task);
    }
    this.finalizerRunners.clear();
    const runner = this.vm.heap.lifetime?.finalizers?.context?.active?.runner;
    if (runner) this.finalizerRunners.add(runner);
  }

  snapshot() {
    return {rootRegistry: this.rootRegistry.snapshot(), disposed: this.disposed,
      contextRoots: [...this.contextRoots].map(bridge => ({bridge, revision: bridge.registry.revision}))};
  }

  assertRestorable(state) {
    assertContextRootsRestorable(this, state);
  }

  restore(state) {
    this.rootRegistry.restore(state?.rootRegistry);
    this.disposed = state?.disposed ?? false;
  }

  dispose() {
    if (this.disposed) return;
    disposeRuntimeGC(this);
    this.disposed = true;
  }
}
