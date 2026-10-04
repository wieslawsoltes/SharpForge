import { performance } from 'node:perf_hooks';
import { cpus, platform, release, arch } from 'node:os';
import { Session } from 'node:inspector/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const api = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : await import('../../compiler/src/metadata-import/attributes.js');
const iterations = 2000;
const samples = 31;
const signature = Uint8Array.from([1,0,2,97,98,7,0,0,0,2,0,0,0,1,0,1,0,84,2,4,70,108,97,103,1]);
const parameters = [{ kind: 'primitive', code: 14 }, { kind: 'primitive', code: 8 },
  { kind: 'szarray', element: { kind: 'primitive', code: 2 } }];
const actions = { decode: () => api.decodeAttributeBlob(signature, parameters) };
const decoded = actions.decode();
assert.equal(decoded.hasErrors, false);
assert.deepEqual(decoded.constructorArguments.map(argument => argument.type), ['System.String', 'System.Int32', null]);
assert.deepEqual(decoded.namedArguments.map(argument => argument.value.value), [true]);
const results = {};
function allocationSize(node) {
  return node.selfSize + node.children.reduce((sum, child) => sum + allocationSize(child), 0);
}
for (const [name, action] of Object.entries(actions)) {
  const coldStart = performance.now();
  action();
  const coldMicroseconds = (performance.now() - coldStart) * 1000;
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
