const canonicalCalls = new WeakMap();

/** Preserve host instance and subclass overrides when a prepared call bypasses the public method. */
export function registerCanonicalCilCall(vm, call) { canonicalCalls.set(vm, call); }
export function hasCanonicalCilCall(vm) { return vm.call === canonicalCalls.get(vm); }
