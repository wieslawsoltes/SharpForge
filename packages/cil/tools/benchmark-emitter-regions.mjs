import { writeFileSync } from 'node:fs';
import { compile } from '@sharpforge/compiler';
import { emitAssembly } from '../src/index.js';
import { cases } from '../../../tests/fixtures/a03-emitter-regions/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path');
const inputs = [
  { name: 'no-handlers', source: 'int x=0;' + 'x+=1;'.repeat(100) + 'Console.WriteLine(x);' },
  { name: 'flat-catch', source: 'try{throw new Exception("x");}catch(Exception e){Console.WriteLine(e.Message);}' },
  ...cases,
];
const results = [];
for (const input of inputs) {
  const compiled = compile(input.source);
  if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
  const samples = [];
  for (let index = 0; index < 9; index++) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const bytes = emitAssembly(compiled.image);
    const ms = performance.now() - started;
    const heapDelta = process.memoryUsage().heapUsed - heap;
    if (index > 1) samples.push({ ms, heapDelta, bytes: bytes.length });
  }
  const sorted = samples.map(sample => sample.ms).sort((left, right) => left - right);
  results.push({ name: input.name, medianMs: sorted[3], p95Ms: sorted[6], samples });
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform,
  architecture: process.arch, results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ samples, ...summary }) => summary)));
