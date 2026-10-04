function clearExecution(vm) {
  vm.frames = [];
  if (vm.stack) vm.stack = [];
  vm.returnValue = null;
  vm.pendingFault = null;
  vm.fault = null;
  vm.currentPoint = null;
  if (vm.statics instanceof Map) vm.statics.clear();
  else vm.statics.fill(null);
  vm.strings.clear();
  vm.constantValues?.clear();
  vm.typeObjects?.clear();
  vm.initialized?.clear();
}

/** .NET Core shutdown policy: discard pending finalizers and release host resources deterministically. */
export function disposeRuntimeGC(runtime) {
  const {vm} = runtime;
  for (const scope of runtime.debuggerScopes) scope.dispose();
  runtime.debuggerScopes.clear();
  runtime.debuggerSessions.clear();
  vm.scheduler.cancelAll();
  for (const bridge of runtime.contextRoots) bridge.dispose();
  if (!vm.heap.lifetime) vm.platform.closeAll();
  vm.heap.lifetime?.shutdown();
  vm.platform.application = null;
  vm.platform.singletons.clear();
  vm.platform.animations.states.clear();
  vm.platform.animations.bases.clear();
  vm.platform.propertyIndexes = new WeakMap();
  vm.platform.transaction = null;
  vm.scheduler.dispose();
  runtime.finalizerWaits.clear();
  runtime.rootRegistry.clear();
  clearExecution(vm);
  runtime.finalizerRunners.clear();
  vm.layoutCache?.clear();
  vm.heap.spaces?.frozen.clear();
  vm.heap.collect([], {generation: 2, reason: 'Shutdown', blocking: true});
  runtime.safepointLease?.dispose?.();
  if (typeof runtime.safepointLease === 'function') runtime.safepointLease();
  vm.state = 'terminated';
}
