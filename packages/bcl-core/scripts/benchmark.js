import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import os from 'node:os';

// --root also measures a clean checkout with the same workload and Node engine.
const rootArgument = process.argv.indexOf('--root');
const root = resolve(rootArgument < 0 ? '.' : process.argv[rootArgument + 1]);
const require = createRequire(resolve(root, 'package.json'));
const {compileToIL} = await import(pathToFileURL(require.resolve('@sharpforge/compiler')));
const {VirtualMachine, CilVirtualMachine} = await import(pathToFileURL(require.resolve('@sharpforge/runtime')));
const workloads = {
  text: 'var b=new System.Text.StringBuilder();for(int i=0;i<500;i++){b.Append(i);b.Append("x");}Console.WriteLine(b.Length);',
  collection: 'var a=new System.Collections.Generic.List<int>();for(int i=0;i<500;i++){a.Add(i);}Console.WriteLine(a.Count);',
  array: 'var a=new int[100];for(int i=0;i<100;i++){System.Array.Fill(a,i);}Console.WriteLine(a[99]);',
  formatting: 'for(int i=0;i<150;i++){string.Format("{0:D4}:{1:F2}",i,2.25);}'
};
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const measurements = [];
for (const [name, body] of Object.entries(workloads)) {
  const compiled = compileToIL('using System;' + body);
  if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
  for (const [engine, create] of [
    ['source', () => new VirtualMachine(compiled.image)],
    ['cil', () => new CilVirtualMachine(compiled.assembly)]
  ]) {
    const times = [];
    const allocations = [];
    for (let iteration = 0; iteration < 24; iteration++) {
      const begin = performance.now();
      const vm = create();
      const result = vm.run();
      if (result.state !== 'terminated') throw new Error(JSON.stringify(result.fault));
      times.push(performance.now() - begin);
      allocations.push(vm.heap.stats.allocatedBytes);
    }
    const warm = times.slice(4);
    measurements.push({name, engine, coldMs: times[0], medianMs: quantile(warm, 0.5),
      p95Ms: quantile(warm, 0.95), p99Ms: quantile(warm, 0.99), managedAllocatedBytes: quantile(allocations, 0.5)});
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0].model, samples: 20, measurements}, null, 2));
