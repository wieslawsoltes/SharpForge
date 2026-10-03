import { performance } from 'node:perf_hooks';
import { cpus, platform, release, arch } from 'node:os';
import { Session } from 'node:inspector/promises';
import { pathToFileURL } from 'node:url';

const api = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : await import('@sharpforge/cil');
const iterations = 2000;
const samples = 31;
const parameters = ['int', 'string', 'double', 'object', 'long', 'bool'];
let signature;
const actions = {
  encode: () => api.methodSignature('int', parameters, true),
  decode: () => api.readSignature(signature),
};
const results = {};
function allocationSize(node) {
  return node.selfSize + node.children.reduce((sum, child) => sum + allocationSize(child), 0);
}
for (const [name, action] of Object.entries(actions)) {
  if (name === 'decode') signature = api.methodSignature('int', parameters, true);
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
