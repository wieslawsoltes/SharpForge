import {prepareExecution} from '@sharpforge/runtime';
import {finalizeRow} from './evidence.js';
import {metricPlan} from './metric-contracts.js';
import {withVM, createVM, prepareWarmVM, restoreForReplay, executionSample, samplePhase, abortIfNeeded} from './operations.js';

export async function measureMicro(fixture, engine, artifact, protocol, signal, onRow = () => {}) {
  const row = {id: `micro/${fixture.id}/${engine}`, kind: 'micro', engine, fixture: fixture.id,
    ...metricPlan('micro', engine, protocol), samples: []};
  if (fixture.dispatchByEngine) row.dispatch = fixture.dispatchByEngine[engine];
  if (fixture.unsupported?.[engine]) {
    Object.assign(row, {status: 'unsupported', reason: fixture.unsupported[engine], metrics: {}, unavailableMetrics: {}});
    onRow(row);
    return row;
  }
  onRow(row);
  return withVM(() => createVM(engine, artifact, protocol.vmOptions), async vm => {
    const initial = prepareWarmVM(vm, signal);
    row.preparation = initial.preparation;
    for (let index = 0; index <= protocol.warmup + protocol.samples; index++) {
      abortIfNeeded(signal);
      restoreForReplay(vm, initial.snapshot);
      const prepared = prepareExecution(vm);
      if (!['prepared', 'not-required'].includes(prepared.status)) throw new Error('Warm sample preparation failed');
      globalThis.gc?.();
      const sample = await executionSample(vm, fixture, signal);
      row.samples.push({index, phase: samplePhase(index, protocol.warmup), ...sample});
    }
    return finalizeRow(row);
  });
}
