import {prepareExecution} from '@sharpforge/runtime';
import {finalizeRow, measuredMetric} from './evidence.js';
import {withVM, createVM, prepareWarmVM, executionSample, samplePhase, abortIfNeeded} from './operations.js';

export async function measureMicro(fixture, engine, artifact, protocol, signal, onRow = () => {}) {
  const row = {id: `micro/${fixture.id}/${engine}`, kind: 'micro', engine, fixture: fixture.id,
    metrics: {executionMs: measuredMetric('ms'), instructionsPerSecond: measuredMetric('instructions/s', ['median'], 'lower'),
      managedAllocations: measuredMetric('objects', ['median']), managedAllocatedBytes: measuredMetric('bytes', ['median'])}, samples: []};
  if (fixture.unsupported?.[engine]) {
    Object.assign(row, {status: 'unsupported', reason: fixture.unsupported[engine], metrics: {}});
    onRow(row);
    return row;
  }
  onRow(row);
  return withVM(() => createVM(engine, artifact, protocol.vmOptions), async vm => {
    const initial = await prepareWarmVM(vm, fixture, signal);
    for (let index = 0; index <= protocol.warmup + protocol.samples; index++) {
      abortIfNeeded(signal);
      vm.restore(initial);
      const prepared = prepareExecution(vm);
      if (prepared.status !== 'prepared') throw new Error('Warm sample preparation failed');
      globalThis.gc?.();
      const sample = await executionSample(vm, fixture, signal);
      row.samples.push({index, phase: samplePhase(index, protocol.warmup), ...sample});
    }
    return finalizeRow(row);
  });
}
