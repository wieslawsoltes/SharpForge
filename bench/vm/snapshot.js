import * as runtime from '@sharpforge/runtime';
import {finalizeRow} from './evidence.js';
import {metricPlan} from './metric-contracts.js';
import {withVM, createVM, abortIfNeeded, runVM, assertOutput, hostMemory, samplePhase,
  restoreForReplay, resumeReplay, managedMemory} from './operations.js';

export const portableSnapshotsAvailable = () => typeof runtime.serializeSnapshot === 'function' &&
  typeof runtime.restoreSerializedSnapshot === 'function';

function wireSize(wire) {
  if (typeof wire === 'string') return Buffer.byteLength(wire);
  if (wire instanceof ArrayBuffer || ArrayBuffer.isView(wire)) return wire.byteLength;
  return Buffer.byteLength(JSON.stringify(wire));
}

function captureDiagnostics(vm, snapshot) {
  const metrics = runtime.snapshotStatistics?.(snapshot) ?? snapshot.heap?.metrics ?? vm.heap.lastSnapshot;
  return metrics ? {status: 'available', metrics: structuredClone(metrics)} : {status: 'unavailable'};
}

async function portableSample(context, sample, snapshot) {
  const {vm, engine, artifact, protocol, signal, fixture} = context;
  let copy;
  if (protocol.portableSnapshots) {
    let at = performance.now();
    const wire = await runtime.serializeSnapshot(vm, snapshot);
    sample.exportMs = performance.now() - at;
    at = performance.now();
    copy = structuredClone(wire);
    sample.structuredCopyMs = performance.now() - at;
    sample.wireBytes = wireSize(wire);
  }
  await withVM(() => {
    const at = performance.now();
    const fresh = createVM(engine, artifact, protocol.vmOptions);
    sample.freshConstructionMs = performance.now() - at;
    sample.freshInitialization = managedMemory(fresh);
    return fresh;
  }, async fresh => {
    if (!protocol.portableSnapshots) return;
    const at = performance.now();
    await runtime.restoreSerializedSnapshot(fresh, copy);
    sample.importRestoreMs = performance.now() - at;
    resumeReplay(fresh);
    await runVM(fresh, signal);
    assertOutput(fresh, fixture);
    sample.portableOutputVerified = true;
  });
}

/** Capture, local replay, transfer copy, and fresh-VM restore are independent measured boundaries. */
export async function measureSnapshot(fixture, engine, artifact, protocol, signal, onRow = () => {}) {
  if (protocol.portableSnapshots !== portableSnapshotsAvailable()) throw new Error('Portable snapshot capability changed');
  const row = {id: `snapshot/${fixture.id}/${engine}`, kind: 'snapshot', engine, fixture: fixture.id, samples: [],
    ...metricPlan('snapshot', engine, protocol)};
  onRow(row);
  return withVM(() => createVM(engine, artifact, protocol.vmOptions), async vm => {
    while (vm.output.join('') !== fixture.boundaryOutput) {
      abortIfNeeded(signal);
      if (!['ready', 'running'].includes(vm.state)) throw new Error('Snapshot fixture did not reach its populated heap boundary');
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 8});
      if (vm.instructions > 1000000) throw new Error('Snapshot boundary instruction limit exceeded');
    }
    for (let index = 0; index <= protocol.warmup + protocol.samples; index++) {
      abortIfNeeded(signal);
      globalThis.gc?.();
      const sample = {index, phase: samplePhase(index, protocol.warmup), hostBefore: hostMemory()};
      let at = performance.now();
      const snapshot = vm.snapshot();
      sample.captureMs = performance.now() - at;
      sample.captureDiagnostics = captureDiagnostics(vm, snapshot);
      at = performance.now();
      restoreForReplay(vm, snapshot);
      sample.restoreMs = performance.now() - at;
      await portableSample({vm, engine, artifact, protocol, signal, fixture}, sample, snapshot);
      const before = managedMemory(vm);
      at = performance.now();
      await runVM(vm, signal);
      sample.replayMs = performance.now() - at;
      assertOutput(vm, fixture);
      const after = managedMemory(vm);
      sample.replayManagedAllocations = after.allocations - before.allocations;
      sample.replayManagedAllocatedBytes = after.allocatedBytes - before.allocatedBytes;
      sample.hostAfter = hostMemory();
      sample.outputVerified = true;
      row.samples.push(sample);
      // Restore after every replay, outside all timed phases, so each observation starts at the same boundary.
      restoreForReplay(vm, snapshot);
    }
    return finalizeRow(row);
  });
}
