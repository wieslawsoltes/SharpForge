// Compile time and inference work for chained and nested expressions, by depth.
// Usage: node packages/compiler/bench/compile-complexity.bench.js [--pipeline bound|legacy] [--depths 4,8,12] [--budget-ms 5000]
//        [--only shapeName,...] [--iterations 9]
// Prints JSON: per shape and depth the median compile time and the number of `infer` evaluations that were not
// answered from the memo. A shape stops at the first depth whose compile exceeds the budget (reported as `stopped`).
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { Compilation } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { nestingShapes, reportedDepths } from './nesting-shapes.js';
import { lambdaShapes } from './lambda-shapes.js';

const option = (name, fallback) => {
  const at = process.argv.indexOf('--' + name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const pipeline = option('pipeline', 'bound');
const depths = String(option('depths', reportedDepths.join(','))).split(',').map(Number);
const budgetMs = Number(option('budget-ms', 5000));
const iterations = Number(option('iterations', 9));
const only = option('only', null)?.split(',') ?? null;

/** Compiles `source` once; returns the wall time and the `infer` evaluations of every method binder. */
export function compileOnce(source, pipelineName = 'bound') {
  const compilation = new Compilation([parse(new SourceText(source, 'Program.cs'))], { pipeline: pipelineName });
  const start = performance.now();
  const result = compilation.build();
  const ms = performance.now() - start;
  const units = compilation.boundPipeline?.units ?? [];
  const inferences = units.reduce((sum, unit) => sum + (unit.binder.inferredTypes?.computations ?? 0), 0);
  return { ms, inferences, success: result.success };
}

function measure(source) {
  const first = compileOnce(source, pipeline);
  if (first.ms > budgetMs) return { medianMs: round(first.ms), p95Ms: round(first.ms), inferences: first.inferences, stopped: true };
  const times = [first.ms];
  for (let index = 1; index < iterations; index++) times.push(compileOnce(source, pipeline).ms);
  times.sort((a, b) => a - b);
  return {
    medianMs: round(times[times.length >> 1]),
    p95Ms: round(times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]),
    inferences: first.inferences,
    success: first.success,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const shapes = {};
for (const [name, source] of Object.entries({ ...nestingShapes, ...lambdaShapes })) {
  if (only && !only.includes(name)) continue;
  shapes[name] = {};
  for (const depth of depths) {
    const entry = measure(source(depth));
    shapes[name][depth] = entry;
    if (entry.stopped) break;
  }
}
console.log(
  JSON.stringify({ node: process.version, os: platform(), arch: arch(), cpu: cpus()[0].model, pipeline, iterations, shapes }, null, 1),
);
