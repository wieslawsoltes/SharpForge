import {cpus, platform, arch} from 'node:os';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, prepareExecution, executionCodeStatistics} from '@sharpforge/runtime';
import {sourceFusionFixtures} from './source-fusion-fixtures.js';

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

function sample(image, sourceFusion, expected) {
  const started = performance.now();
  const vm = new VirtualMachine(image, {sourceFusion, maxInstructions: 30_000_000});
  try {
    const preparation = prepareExecution(vm);
    const coldMilliseconds = performance.now() - started;
    const executeStarted = performance.now(), result = vm.run();
    const executionMilliseconds = performance.now() - executeStarted;
    if (result.state !== 'terminated' || result.output !== expected) {
      throw new Error('Source dispatch workload failed: ' + JSON.stringify({state: result.state, output: result.output, fault: result.fault}));
    }
    return {coldMilliseconds, executionMilliseconds, instructions: vm.instructions,
      allocations: vm.heap.stats.allocations, allocatedBytes: vm.heap.stats.allocatedBytes,
      fusedGroups: executionCodeStatistics(vm).sourceFusionGroups, preparation};
  } finally {
    vm.stop();
  }
}

const rows = [];
for (const workload of sourceFusionFixtures) {
  const artifact = compileToIL(workload.source);
  if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
  for (let warmup = 0; warmup < 4; warmup++) {
    sample(artifact.image, false, workload.expected);
    sample(artifact.image, true, workload.expected);
  }
  const measurements = {ordinary: [], fused: []};
  // Reverse each pair to avoid always giving either mode the later/cooler sample.
  for (let index = 0; index < 11; index++) {
    for (const enabled of index % 2 ? [true, false] : [false, true]) {
      measurements[enabled ? 'fused' : 'ordinary'].push(sample(artifact.image, enabled, workload.expected));
    }
  }
  const ordinary = summarize(measurements.ordinary.map(row => row.executionMilliseconds));
  const fused = summarize(measurements.fused.map(row => row.executionMilliseconds));
  const speedup = ordinary.median / fused.median;
  if (!measurements.fused.every(row => row.fusedGroups > 0)) throw new Error('The fused workload executed no fusion groups');
  if (measurements.fused.some((row, index) => row.instructions !== measurements.ordinary[index].instructions)) {
    throw new Error('Fusion changed guest instruction counts');
  }
  rows.push({name: workload.id, ordinary, fused, speedup, targetSpeedup: 1.5, meetsTarget: speedup >= 1.5,
    cold: {ordinary: summarize(measurements.ordinary.map(row => row.coldMilliseconds)),
      fused: summarize(measurements.fused.map(row => row.coldMilliseconds))}, samples: measurements});
}

process.stdout.write(JSON.stringify({format: 'SharpForge.SourceFusionComparison/1', clock: 'milliseconds',
  platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? null, node: process.version,
  backend: 'JavaScript source VM', qualified: false, sampleCount: 11, warmupPairs: 4,
  note: 'Development-host measurements. Platform qualification and the statistical gate are separate.', rows}, null, 2) + '\n');
