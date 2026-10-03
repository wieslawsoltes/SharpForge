import { performance } from 'node:perf_hooks';
import { cpus, platform, release, arch } from 'node:os';
import { Session } from 'node:inspector/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeCoded } from '@sharpforge/cil';

const api = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : await import('../../compiler/src/metadata-import/pe-metadata.js');
const iterations = 2000;
const samples = 31;
const metadata = new api.MetadataView(new Uint8Array(readFileSync(new URL('../../../tests/fixtures/metadata/MiniStandard.dll', import.meta.url))));
const row = metadata.rows(11).find(row => row[0] === 8);
assert.ok(row, 'Native metadata fixture contains an Int32 constant');
const parent = decodeCoded('HasConstant', row[1]);
const expected = new DataView(metadata.blob(row[2]).buffer, metadata.blob(row[2]).byteOffset, 4).getInt32(0, true);
const actions = { decode: () => metadata.constant(parent) };
const results = {};
function allocationSize(node) {
  return node.selfSize + node.children.reduce((sum, child) => sum + allocationSize(child), 0);
}
for (const [name, action] of Object.entries(actions)) {
  const coldStart = performance.now();
  const initial = action();
  const coldMicroseconds = (performance.now() - coldStart) * 1000;
  assert.equal(initial.value, expected);
  for (let index = 0; index < iterations; index++) action();
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) action();
    times.push((performance.now() - start) * 1000 / iterations);
  }
  times.sort((a, b) => a - b);
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.startSampling', {
    samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
  });
  for (let index = 0; index < iterations; index++) action();
  const { profile } = await session.post('HeapProfiler.stopSampling');
  session.disconnect();
  results[name] = {
    coldMicroseconds, medianMicroseconds: times[15], p95Microseconds: times[29], p99Microseconds: times[30],
    sampledAllocationBytesPerOperation: allocationSize(profile.head) / iterations,
  };
}
console.log(JSON.stringify({
  node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0].model,
  iterations, samples, allocationMetric: 'V8 sampled allocations, including collected objects; estimate, not exact bytes', results,
}, null, 2));
