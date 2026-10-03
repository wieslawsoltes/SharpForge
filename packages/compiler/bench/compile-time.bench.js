// Compile time of `compile()` on the `npm run bench` corpus and on large synthetic programs.
// Usage: node [--expose-gc] packages/compiler/bench/compile-time.bench.js [--iterations 15] [--warmup 3] [--only name,...]
// Prints JSON: per case the lines, the cold time, median and p95 of the warm iterations, and the median heap growth
// of one compile (an allocation proxy; pass --expose-gc to collect before each iteration).
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { compile } from '@sharpforge/compiler';
import { syntheticProgram, generatedCorpus } from './synthetic-program.js';

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const iterations = Number(option('iterations', 15));
const warmup = Number(option('warmup', 3));
const only = option('only', null)?.split(',') ?? null;

/** Case name -> the `compile()` input and whether the compilation is expected to produce an image. */
export const compileTimeCases = {
  corpus1K: { input: generatedCorpus(10, 90), succeeds: true },
  corpus10K: { input: generatedCorpus(25, 390), succeeds: true },
  syntheticExecutable5K: { input: syntheticProgram(110, { full: false }), succeeds: true },
  syntheticFull5K: { input: syntheticProgram(60), succeeds: false },
};

const lineCount = input => (typeof input === 'string' ? [input] : input.map(file => file.text)).reduce((sum, text) => sum + text.split('\n').length, 0);
const round = value => Math.round(value * 100) / 100;
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];

function measure({ input, succeeds }) {
  const coldStart = performance.now();
  const first = compile(input);
  const coldMs = performance.now() - coldStart;
  if (first.success !== succeeds) throw new Error('Unexpected compilation result: ' + JSON.stringify(first.diagnostics.slice(0, 3)));
  for (let index = 0; index < warmup; index++) compile(input);
  const times = [],
    heaps = [];
  for (let index = 0; index < iterations; index++) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed,
      start = performance.now();
    compile(input);
    times.push(performance.now() - start);
    heaps.push(Math.max(0, process.memoryUsage().heapUsed - heap));
  }
  times.sort((a, b) => a - b);
  heaps.sort((a, b) => a - b);
  return {
    lines: lineCount(input),
    coldMs: round(coldMs),
    medianMs: round(percentile(times, 0.5)),
    p95Ms: round(percentile(times, 0.95)),
    minMs: round(times[0]),
    medianHeapGrowthMB: round(percentile(heaps, 0.5) / 2 ** 20),
  };
}

const cases = {};
for (const [name, testCase] of Object.entries(compileTimeCases)) if (!only || only.includes(name)) cases[name] = measure(testCase);
console.log(
  JSON.stringify(
    { node: process.version, os: platform(), arch: arch(), cpu: cpus()[0].model, iterations, warmup, exposedGc: !!globalThis.gc, cases },
    null,
    1,
  ),
);
