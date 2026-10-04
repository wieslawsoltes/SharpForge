import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { compileToIL } from '@sharpforge/compiler';
import * as current from '@sharpforge/symbols';

const samples = 30;
const text = 'public class Example { public int Value => 42; }\n'.repeat(200);
const compiled = compileToIL('Console.WriteLine(1);', { portablePdb: false });
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const debug = { sources: [{ uri: '/src/Example.cs', text }] };
const libraries = [{ name: 'current', library: current }];
const baselineIndex = process.argv.indexOf('--baseline');
if (baselineIndex >= 0) {
  const directory = resolve(process.argv[baselineIndex + 1]);
  const require = createRequire(resolve(directory, 'package.json'));
  libraries.unshift({
    name: directory,
    library: await import(pathToFileURL(require.resolve('@sharpforge/symbols')).href),
  });
}
function measure(action) {
  global.gc?.();
  const before = process.memoryUsage();
  const coldStart = performance.now();
  action();
  const coldMs = performance.now() - coldStart;
  for (let index = 0; index < 5; index++) action();
  const times = [];
  for (let index = 0; index < samples; index++) {
    const start = performance.now();
    action();
    times.push(performance.now() - start);
  }
  const after = process.memoryUsage();
  times.sort((left, right) => left - right);
  return {
    coldMs,
    medianMs: times[Math.floor(samples / 2)],
    p95Ms: times[Math.ceil(samples * 0.95) - 1],
    p99Ms: times[Math.ceil(samples * 0.99) - 1],
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers,
  };
}
const results = libraries.map(({ name, library }) => {
  const emitted = library.emitPortablePdb(compiled.assembly, debug);
  const attached = library.attachPortablePdb(compiled.assembly, emitted.bytes, { embedded: true });
  return {
    name,
    sourceBytes: new TextEncoder().encode(text).length,
    pdbBytes: emitted.bytes.length,
    assemblyBytes: attached.length,
    emit: measure(() => library.emitPortablePdb(compiled.assembly, debug)),
    read: measure(() => library.readPortablePdb(emitted.bytes)),
    load: measure(() => library.loadSymbols(attached)),
  };
});
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      samples,
      allocationNote: 'Observed heap/ArrayBuffer deltas, not total allocation counters',
      results,
    },
    null,
    2,
  ),
);
