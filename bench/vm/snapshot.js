import {serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {finalizeRow, measuredMetric} from './evidence.js';
import {withVM, createVM, abortIfNeeded, runVM, assertOutput, hostMemory, samplePhase} from './operations.js';

/** Snapshot cost is measured separately from execution; restoring managed counters is never called an allocation. */
export async function measureSnapshot(fixture, engine, artifact, protocol, signal, onRow = () => {}) {
  const metrics = ['captureMs', 'restoreMs', 'exportMs', 'structuredCopyMs', 'importRestoreMs', 'freshConstructionMs'];
  const row = {id: `snapshot/${fixture.id}/${engine}`, kind: 'snapshot', engine, fixture: fixture.id, samples: [],
    metrics: Object.fromEntries(metrics.map(key => [key, measuredMetric('ms')]))};
  onRow(row);
  return withVM(() => createVM(engine, artifact, protocol.vmOptions), async vm => {
    while (vm.output.join('') !== 'snapshot\n') {
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
      sample.cow = {...vm.heap.lastSnapshot};
      at = performance.now();
      vm.restore(snapshot);
      sample.restoreMs = performance.now() - at;
      at = performance.now();
      const wire = await serializeSnapshot(vm, snapshot);
      sample.exportMs = performance.now() - at;
      at = performance.now();
      const copy = structuredClone(wire);
      sample.structuredCopyMs = performance.now() - at;
      sample.wireBytes = Buffer.byteLength(JSON.stringify(wire));
      await withVM(() => {
        at = performance.now();
        const fresh = createVM(engine, artifact, protocol.vmOptions);
        sample.freshConstructionMs = performance.now() - at;
        sample.freshInitializationAllocations = fresh.heap.stats.allocations;
        return fresh;
      }, async fresh => {
        at = performance.now();
        await restoreSerializedSnapshot(fresh, copy);
        sample.importRestoreMs = performance.now() - at;
        await runVM(fresh, signal);
        assertOutput(fresh, fixture);
      });
      sample.hostAfter = hostMemory();
      sample.outputVerified = true;
      row.samples.push(sample);
    }
    await runVM(vm, signal);
    assertOutput(vm, fixture);
    return finalizeRow(row);
  });
}
