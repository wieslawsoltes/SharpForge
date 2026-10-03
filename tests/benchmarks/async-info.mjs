import { cpus, platform, arch } from 'node:os';
import { codedIndex, token } from '@sharpforge/cil';
import { PortablePdbBuilder, PdbGuids, readPortablePdb, writeCustomDebugInformation } from '@sharpforge/symbols';

const count = 1000;
const builder = new PortablePdbBuilder();
for (let row = 1; row <= count; row++) {
  builder.add(54, [row, row + count]);
  builder.add(55, [
    codedIndex('HasCustomDebugInformation', token(6, row)),
    builder.guid(PdbGuids.asyncSteps),
    builder.blob(
      writeCustomDebugInformation(PdbGuids.asyncSteps, {
        awaits: [{ yieldOffset: 1, resumeOffset: 2, resumeMethod: token(6, row) }],
      }),
    ),
  ]);
}
const bytes = builder.finish({ 6: count * 2 }, 0).bytes;
const setupSamples = [];
for (let warmup = 0; warmup < 3; warmup++) readPortablePdb(bytes).asyncInfo(token(6, 1));
for (let sample = 0; sample < 15; sample++) {
  globalThis.gc?.();
  const start = performance.now();
  for (let iteration = 0; iteration < 10; iteration++) {
    if (readPortablePdb(bytes).asyncInfo(token(6, 1)).steps.length !== 1) throw Error('Incomplete setup result');
  }
  setupSamples.push((performance.now() - start) / 10);
}
setupSamples.sort((left, right) => left - right);
const symbols = readPortablePdb(bytes);
const query = () => {
  let total = 0;
  for (let repeat = 0; repeat < 10; repeat++) {
    for (let row = 1; row <= count; row++) total += symbols.asyncInfo(token(6, row)).steps.length;
  }
  if (total !== count * 10) throw Error('Async-info benchmark result was incomplete');
};
for (let warmup = 0; warmup < 3; warmup++) query();
const samples = [];
for (let sample = 0; sample < 15; sample++) {
  globalThis.gc?.();
  const start = performance.now();
  query();
  samples.push((performance.now() - start) / (count * 10));
}
samples.sort((left, right) => left - right);
console.log(
  JSON.stringify(
    {
      revision: process.env.SF_BENCH_REVISION ?? null,
      node: process.version,
      host: `${platform()} ${arch()} ${cpus()[0].model}`,
      samples: 15,
      stateMachines: count,
      queriesPerSample: count * 10,
      medianMsPerQuery: samples[7],
      p95MsPerQuery: samples[14],
      setupPerSample: 10,
      medianMsParseAndFirstQuery: setupSamples[7],
      p95MsParseAndFirstQuery: setupSamples[14],
      allocationMeasurement: 'Not measured; queries now return independent state and step records.',
    },
    null,
    2,
  ),
);
