import { writeFileSync } from 'node:fs';
import { readMetadata } from '@sharpforge/cil';
import { nestedTypeMetadata } from '../../../tests/helpers/nested-type-metadata.js';

const [label, countsText, destination] = process.argv.slice(2);
const counts = (countsText ?? '1000,5000,200000').split(',').map(Number);
if (!label || !destination || counts.some(count => !Number.isInteger(count) || count < 1 || count > 200000)) {
  throw new Error('Usage: benchmark-type-names.mjs LABEL COUNTS OUTPUT_JSON');
}
const observations = [];
for (const count of counts) {
  const bytes = nestedTypeMetadata(count), samples = [];
  for (let sample = 0; sample < 7; sample++) {
    global.gc?.();
    const metadata = readMetadata(bytes);
    global.gc?.();
    const heap = process.memoryUsage().heapUsed, started = performance.now();
    let characters = 0;
    for (let id = 2; id <= count + 1; id++) characters += metadata.typeName(0x02000000 + id).length;
    const durationMs = performance.now() - started, heapDelta = process.memoryUsage().heapUsed - heap;
    if (characters < count) throw new Error('Names were not observed');
    samples.push({ durationMs, heapDelta });
  }
  const durations = samples.map(value => value.durationMs).sort((left, right) => left - right);
  const heaps = samples.map(value => value.heapDelta).sort((left, right) => left - right);
  observations.push({ count, metadataBytes: bytes.length, medianMs: durations[3], p95Ms: durations[6],
    medianHeapDelta: heaps[3], underOneSecondEverySample: durations[6] < 1000, samples });
}
writeFileSync(destination, JSON.stringify({ label, node: process.version, platform: process.platform,
  architecture: process.arch, scope: 'Cold first naming pass after metadata parsing; seven serial samples', observations }, null, 2) + '\n');
