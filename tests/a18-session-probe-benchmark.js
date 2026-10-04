import {performance} from 'node:perf_hooks';
import {cpus, totalmem} from 'node:os';
import {probeDesignSource, CSharpDesignSession} from '@sharpforge/designer';

const members = Array.from({length: 1992}, (_, index) => `    static int value${index} = ${index};`).join('\n');
const source = `class View\n{\n${members}\n    static Window Create()\n    {\n        var window = new Window();\n        return window;\n    }\n}`;
function measure(action) {
  for (let iteration = 0; iteration < 10; iteration++) action();
  const times = [];
  for (let iteration = 0; iteration < 50; iteration++) {
    const start = performance.now();
    action();
    times.push(performance.now() - start);
  }
  times.sort((left, right) => left - right);
  return {medianMs: times[25], p95Ms: times[47]};
}
console.log(JSON.stringify({
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  machine: {cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, memoryBytes: totalmem()},
  lines: source.split('\n').length,
  characters: source.length,
  fullDesignSession: measure(() => new CSharpDesignSession(source, {uri: 'View.cs'})),
  compatibilityProbe: measure(() => probeDesignSource(source, 'View.cs'))
}, null, 2));
