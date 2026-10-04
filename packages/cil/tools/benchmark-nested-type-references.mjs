import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { nestedReferenceFixture } from '../../../tests/fixtures/a03-nested-type-references/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit benchmark JSON path');
const fixture = nestedReferenceFixture();
const inspector = fixture.inspect();
const rounds = 12;
const iterations = 1000;
const samples = [];
let known = 0;
for (let round = 0; round < rounds; round++) {
  global.gc?.();
  const heap = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    const adapter = createMetadataVerificationTypeSystem(inspector);
    known += adapter.resolveType(fixture.tokens.leaf).status === 'known' ? 1 : 0;
  }
  samples.push({ elapsedMs: performance.now() - start, heapDelta: process.memoryUsage().heapUsed - heap });
}
const measured = samples.slice(3).map(sample => sample.elapsedMs).sort((left, right) => left - right);
const result = { platform: `${process.platform}-${process.arch}`, release: os.release(), cpu: os.cpus()[0].model,
  node: process.version, gc: !!global.gc, iterations, rounds, warmups: 3, sharedMachine: true,
  known, medianMs: measured[Math.floor(measured.length / 2)], p95Ms: measured[Math.ceil(measured.length * 0.95) - 1],
  samples, note: 'Construction plus one resolution per iteration. Heap deltas are not allocation volume or peak memory.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ medianMs: result.medianMs, p95Ms: result.p95Ms, known }));
