import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { SourceText, TextBuffer } from '../src/index.js';

function summarize(samples) {
  samples.sort((first, second) => first - second);
  return { medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)] };
}

const text = 'line\r\n'.repeat(1000000);
const source = new SourceText(text);
void source.lineStarts;
const buffer = new TextBuffer(text);
const rows = [];
for (const [region, offset] of [['start', 0], ['middle', Math.floor(text.length / 2)], ['end', text.length]]) {
  const before = [];
  const after = [];
  for (let iteration = 0; iteration < 25; iteration++) {
    const started = performance.now();
    const next = source.withChange(offset, 0, 'x');
    next.positionAt(offset);
    if (iteration >= 5) before.push(performance.now() - started);
  }
  for (let iteration = 0; iteration < 120; iteration++) {
    const started = performance.now();
    buffer.insert(offset, 'x');
    buffer.positionAt(offset);
    if (iteration >= 20) after.push(performance.now() - started);
    buffer.delete(offset, 1);
  }
  rows.push({ region, sourceText: summarize(before), indexedBuffer: summarize(after) });
}
console.log(JSON.stringify({
  runtime: process.version, platform: process.platform, architecture: process.arch,
  cpu: cpus()[0]?.model, lines: 1000000, utf16Length: text.length,
  command: 'node packages/text/bench/buffer.js', metric: 'single insertion plus position query, milliseconds', rows
}, null, 2));
