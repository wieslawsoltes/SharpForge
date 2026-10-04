import {isReference} from './reference.js';

/** Stable labels shared by collection statistics, audits and retention diagnostics. */
export const RootCategory = Object.freeze({
  Stack: 'stack', Static: 'static', Handle: 'handle', Pinned: 'pinned', Finalizer: 'finalizer',
  Scheduler: 'scheduler', HostOperation: 'host-operation', Interop: 'interop', Debugger: 'debugger'
});

const categories = new Set(Object.values(RootCategory));

/** Publish a managed value or the owner of an interior managed address. */
export function visitRootValue(value, visitor, category, detail = null) {
  if (isReference(value)) visitor(value, category, detail);
  else if (value?.byref && value.owner) visitRootValue(value.owner, visitor, category, detail);
}

/** Instance-owned extension seam. Disposal removes the provider immediately. */
export class RootRegistry {
  constructor() {
    this.providers = new Map();
    this.nextId = 1;
  }

  register(category, provider, owner = null) {
    if (!categories.has(category) || typeof provider !== 'function') throw new TypeError('Invalid root provider');
    const id = this.nextId++;
    this.providers.set(id, {category, provider, owner});
    return Object.freeze({dispose: () => this.providers.delete(id)});
  }

  visitRoots(visitor) {
    for (const item of this.providers.values()) item.provider(visitor, item.category, item.owner);
  }

  clear() {
    this.providers.clear();
  }

  snapshot() {
    return {providers: [...this.providers].map(([id, entry]) => [id, {...entry}]), nextId: this.nextId};
  }

  restore(state) {
    this.providers = new Map((state?.providers ?? []).map(([id, entry]) => [id, {...entry}]));
    this.nextId = Math.max(this.nextId, state?.nextId ?? 1);
  }
}

/** Compatibility adapter only; collectors call the visitor and allocate no generator. */
export function* rootValues(provider) {
  const values = [];
  provider.visitRoots(value => values.push(value));
  yield* values;
}

export function visitValues(values, visitor, category, detail = null) {
  if (!values) return;
  for (const value of values) visitRootValue(value, visitor, category, detail);
}

export function visitFault(fault, visitor, category = RootCategory.Stack) {
  if (fault?.reference) visitRootValue(fault.reference, visitor, category, 'exception');
}

/** Both interpreters and parked scheduler/finalizer contexts use the same frame scan. */
export function visitFrameRoots(frame, visitor, category = RootCategory.Stack) {
  visitValues(frame.locals, visitor, category, 'local');
  visitValues(frame.args, visitor, category, 'argument');
  visitValues(frame.stack, visitor, category, 'evaluation-stack');
  visitValues(frame.gcKeepAlive, visitor, category, 'keep-alive');
  visitRootValue(frame.returnObject, visitor, category, 'constructor');
  visitFault(frame.exception, visitor, category);
  visitFault(frame.pending?.error, visitor, category);
  for (const caught of frame.caught ?? []) visitFault(caught.fault, visitor, category);
  for (const unwind of frame.unwinds ?? []) {
    visitRootValue(unwind.value, visitor, category, 'unwind-return');
    visitFault(unwind.error, visitor, category);
  }
}

export function visitExecutionRoots(context, visitor, category = RootCategory.Stack) {
  visitValues(context.stack, visitor, category, 'evaluation-stack');
  visitRootValue(context.returnValue, visitor, category, 'return');
  visitFault(context.fault, visitor, category);
  visitFault(context.pendingFault, visitor, category);
  visitFault(context.resumeFault, visitor, category);
  for (const frame of context.frames ?? []) visitFrameRoots(frame, visitor, category);
}

export function visitVMRoots(vm, visitor) {
  visitExecutionRoots(vm, visitor);
  const statics = vm.statics instanceof Map ? vm.statics.values() : vm.statics;
  visitValues(statics, visitor, RootCategory.Static, 'static');
  visitValues(vm.constantValues?.values(), visitor, RootCategory.Static, 'constant');
  if (!vm.options?.weakStringInterning) visitValues(vm.strings?.values(), visitor, RootCategory.Static, 'interned-string');
  visitValues(vm.typeObjects?.values(), visitor, RootCategory.Static, 'runtime-type');
  for (const state of vm.initialized?.values() ?? []) {
    visitFault(state.fault, visitor, RootCategory.Static);
    visitRootValue(state.waitTask, visitor, RootCategory.Static, 'initializer-wait');
  }
  vm.platform?.visitRoots(visitor);
  vm.scheduler?.visitRoots(visitor);
  vm.gcRuntime?.visitRoots(visitor);
}
