import {assertSnapshotFields} from './execution/snapshot-schema.js';
import {copyExecution} from './execution/execution-copy.js';
import {SnapshotVersionError} from './execution/snapshot-version.js';
import {validateSnapshotState} from './snapshot-validation.js';
import {prepareHeapRestore} from './execution/snapshot-cow.js';
import {copySchedulerSnapshot, restoreSchedulerState} from './execution/scheduler-snapshot.js';
import {snapshotPlatformState, restorePlatformState, notifyPlatformRestore} from './execution/snapshot-platform.js';
import {captureGenericInstantiations, prepareGenericInstantiations, bindRestoredGenericMethods} from './execution/generic-snapshot.js';
import {clearFramePool} from './execution/frame-pool.js';
import {clearStackBudget} from './execution/stack-budget.js';
import {executionCodeState, invalidateExecutionCode} from './execution/code-version.js';
import {restoreFloatFrames} from './execution/typed-float-frame.js';
import {captureWasmDeopt, restoreWasmDeopt} from './execution/wasm/deopt.js';
import {rebuildFrameIndex} from './execution/frame-lifetimes.js';
import {releaseVMFrameMemory} from './execution/frame-memory-release.js';
import {resolveSnapshotTypes} from './execution/snapshot-type-resolution.js';
import {prepareSynchronizationRestore, restoreSnapshotSynchronization} from './execution/snapshot-synchronization.js';
import {requireSnapshotBoundary} from './execution/callback-frames.js';

export {copyExecution, copyFrames} from './execution/execution-copy.js';
export {snapshotSchemas, assertSnapshotFields} from './execution/snapshot-schema.js';
export {snapshotSchemaVersion, SnapshotVersionError} from './execution/snapshot-version.js';

/** Capture one coherent graph, preserving active/parked frame, fault, heap and continuation aliases. */
export function snapshotVM(vm, engine) {
  requireSnapshotBoundary(vm);
  const selected = assertSnapshotFields(vm, engine), memo = new Map();
  const snapshot = {schemaVersion: selected.schemaVersion, engine, owner: vm.snapshotOwner,
    codeOwner: vm.inspector ?? vm.image, nativeIntBits: vm.heap.methodTables.nativeIntBits,
    hostRevision: vm.platform.hostOperations.snapshotVersion()};
  for (const item of selected.fields) {
    if (item.capture) {
      snapshot[item.name] = captureGenericInstantiations(vm);
      continue;
    }
    if (item.optional && !Object.hasOwn(vm, item.name)) continue;
    if (item.name === 'heap') continue;
    else if (item.name === 'scheduler') snapshot.scheduler = vm.scheduler.snapshot(memo);
    else if (item.name === 'platform') snapshot.platform = snapshotPlatformState(vm.platform, memo);
    else if (item.component) snapshot[item.name] = vm[item.name].snapshot(memo);
    else snapshot[item.name] = item.copier(vm[item.name], memo);
  }
  // Execution can retain direct backing aliases. Capture these before the heap
  // decides which otherwise-unchanged record payloads are safe to share.
  snapshot.heap = vm.heap.snapshot({memo});
  if (engine === 'cil') snapshot.heapRevision = vm.heap.mutationRevision;
  return snapshot;
}

/** Header validation is shared by local restore and portable graph export/import. */
export function validateSnapshotHeader(vm, snapshot, engine) {
  const selected = assertSnapshotFields(vm, engine);
  if (snapshot?.owner !== vm.snapshotOwner) throw new TypeError(`Snapshot belongs to another ${engine === 'cil' ? 'CIL' : 'source'} VM`);
  if (snapshot.schemaVersion !== selected.schemaVersion || snapshot.engine !== engine) throw new SnapshotVersionError(engine);
  if (snapshot.codeOwner !== (vm.inspector ?? vm.image)) throw new TypeError('Snapshot belongs to another code generation');
  if (snapshot.nativeIntBits !== vm.heap.methodTables.nativeIntBits) throw new TypeError('Snapshot native integer ABI differs');
  for (const item of selected.fields) {
    if (!item.optional && !Object.hasOwn(snapshot, item.name)) throw new TypeError(`Snapshot is missing '${item.name}'`);
  }
  if (!Number.isSafeInteger(snapshot.hostRevision) || snapshot.hostRevision < 0) throw new TypeError('Invalid snapshot host revision');
  return selected;
}

function prepareRestore(vm, snapshot, selected) {
  const memo = new Map(), values = new Map();
  // Thaw heap backing first so execution aliases resolve to the same fresh data.
  values.set('heap', prepareHeapRestore(vm.heap, snapshot.heap, memo));
  for (const item of selected.fields) {
    if (item.name === 'heap' || item.capture || !Object.hasOwn(snapshot, item.name)) continue;
    let value;
    if (item.name === 'scheduler') value = copySchedulerSnapshot(snapshot.scheduler, memo);
    else if (item.component) value = copyExecution(snapshot[item.name], memo);
    else value = item.copier(snapshot[item.name], memo);
    values.set(item.name, item.restore ? item.restore(value) : item.monotonic ? Math.max(vm[item.name] ?? 0, value) : value);
  }
  return {memo, values};
}

/** Every rejecting preflight finishes before the first replacement of live execution state. */
export function restoreVM(vm, snapshot, engine) {
  requireSnapshotBoundary(vm);
  const selected = validateSnapshotHeader(vm, snapshot, engine);
  vm.platform.hostOperations.checkRestore(snapshot.hostRevision);
  const {generics, values, synchronization} = resolveSnapshotTypes(vm, () => {
    validateSnapshotState(vm, snapshot, engine);
    const generics = engine === 'cil' ? prepareGenericInstantiations(vm, snapshot.genericCacheKeys) : null;
    const prepared = prepareRestore(vm, snapshot, selected);
    if (engine === 'cil') bindRestoredGenericMethods(vm, prepared.values, generics);
    return {generics, ...prepared, synchronization: prepareSynchronizationRestore(vm, prepared.values)};
  });
  vm.profiler?.boundary();
  const deopt = engine === 'cil' ? captureWasmDeopt(vm) : null;
  releaseVMFrameMemory(vm);
  vm.heap.restore(values.get('heap'), {prepared: true});
  for (const item of selected.fields) {
    if (item.component || item.capture) continue;
    if (values.has(item.name)) vm[item.name] = values.get(item.name);
    else if (item.optional && !item.monotonic) delete vm[item.name];
  }
  if (engine === 'source') {
    if (['ready', 'running', 'paused'].includes(vm.state)) vm.state = 'paused';
    vm.currentPoint = vm.top?.point ?? null;
  }
  restoreSnapshotSynchronization(vm, synchronization);
  restoreSchedulerState(vm.scheduler, values.get('scheduler'));
  restorePlatformState(vm.platform, values.get('platform'));
  invalidateExecutionCode(vm, 'snapshot-restore');
  if (engine === 'cil') executionCodeState(vm).generics = generics;
  clearFramePool(vm);
  clearStackBudget(vm);
  restoreFloatFrames(vm);
  if (engine === 'cil') restoreWasmDeopt(vm, deopt);
  rebuildFrameIndex(vm);
  notifyPlatformRestore(vm.platform);
}
