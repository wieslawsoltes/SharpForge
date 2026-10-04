/**
 * Bounded before/after compile measurements for existing tree and ordinary delegate programs (SF-A02-T07.5).
 * Run the identical runner against each retained checkout, serially through scripts/limited.js:
 * node --expose-gc packages/compiler/bench/expression-trees.bench.js --root <checkout> [--iterations 5] [--samples 7]
 * No runtime execution, metadata loading, Git inspection, or forced GC occurs inside the timed compilation loop.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus, platform, arch, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const root = resolve(option('root', fileURLToPath(new URL('../../../', import.meta.url))));
const iterations = Number(option('iterations', 5));
const sampleCount = Number(option('samples', 7));
assert.ok(Number.isInteger(iterations) && iterations >= 3 && iterations <= 20, 'iterations must be within 3..20');
assert.ok(Number.isInteger(sampleCount) && sampleCount >= 5 && sampleCount <= 15, 'samples must be within 5..15');
const { compileToAssembly } = await import(pathToFileURL(join(root, 'packages/compiler/src/index.js')));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const methodCount = 16;

function program(trees) {
  const target = trees ? 'Expression<Func<int, int>>' : 'Func<int, int>';
  const members = Array.from({ length: methodCount }, (_, index) =>
    `static ${target} Make${index}() => value => value * 2 + ${index};`).join('\n');
  return `using System; using System.Linq.Expressions; class Program { ${members} static void Main() { } }`;
}

function sample(source) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let result;
  for (let iteration = 0; iteration < iterations; iteration++) result = compileToAssembly(source);
  const elapsedMs = performance.now() - start;
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.ok(result.assembly?.length > 0, 'the compiler must produce an actual assembly');
  return { elapsedMs, perCompilationMs: elapsedMs / iterations, heapDeltaBytes, assemblyBytes: result.assembly.length };
}

function summary(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return { median: sorted[sorted.length >> 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

const workloads = {};
for (const [name, source] of [['ordinaryDelegates', program(false)], ['existingExpressionTrees', program(true)]]) {
  sample(source);
  sample(source);
  const samples = Array.from({ length: sampleCount }, () => sample(source));
  workloads[name] = {
    perCompilationMs: summary(samples.map(row => row.perCompilationMs)),
    heapDeltaBytes: summary(samples.map(row => row.heapDeltaBytes)),
    assemblyBytes: samples[0].assemblyBytes,
    samples,
  };
}

console.log(JSON.stringify({
  commit, root, node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, memoryBytes: totalmem(),
  methodCount, iterations, sampleCount, warmupSamples: 2, gcAvailable: typeof globalThis.gc === 'function',
  pipeline: 'compileToAssembly against the framework registry; parsing, binding, lowering and direct CIL emission',
  notes: 'Identical source on both revisions; heap deltas may include collection and are not allocation counts. Run on a quiet machine.',
  workloads,
}, null, 2));
