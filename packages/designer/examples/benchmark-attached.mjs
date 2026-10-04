import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {cpus} from 'node:os';

// Run the identical script from each worktree to compare the real managed setter path.
const compiled = compileToIL(`using Microsoft.UI.Xaml.Controls;
  class Program { static void Main() {
    var button = new Button();
    for (int index = 0; index < 1000; index++) Canvas.SetLeft(button, index);
  } }`);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const results = [];
for (const Machine of [VirtualMachine, CilVirtualMachine]) {
  const times = [];
  for (let sample = 0; sample < 101; sample++) {
    const machine = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly);
    global.gc?.();
    const start = performance.now();
    const result = machine.run();
    const elapsed = performance.now() - start;
    if (result.state !== 'terminated') throw new Error(result.fault?.message);
    if (sample >= 20) times.push(elapsed);
  }
  times.sort((left, right) => left - right);
  results.push({engine: Machine.name, iterations: 1000, samples: times.length,
    medianMs: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)]});
}
console.log(JSON.stringify({node: process.version, cpu: cpus()[0].model, results}, null, 2));
