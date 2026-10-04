/**
 * SF-A02-T89 compileToAssembly comparison, run serially on two existing pinned checkouts.
 * Usage: node scripts/limited.js node --expose-gc packages/compiler/bench/unions-paired.bench.mjs
 *   --base-root /path/base --base-revision bf85020e --candidate-root /path/candidate --candidate-revision 46bd2c17
 *   [--pairs 20] [--warmup 3] [--units 12]
 * No checkout is created or changed. Each side uses a fresh worker per pair, warmed before measurement;
 * order alternates, and only one worker runs at a time. This measures compiler cost, not execution speed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, totalmem, platform, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ownPath = fileURLToPath(import.meta.url);
const option = (name, fallback = null) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const integer = (name, fallback, low, high) => {
  const value = Number(option(name, fallback));
  assert(Number.isInteger(value) && value >= low && value <= high, `${name} must be within ${low}..${high}`);
  return value;
};
const digest = input => createHash('sha256').update(input).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
const pinned = (root, expected) => {
  const wanted = git(root, 'rev-parse', '--verify', `${expected}^{commit}`);
  assert.equal(git(root, 'rev-parse', 'HEAD'), wanted, `Unexpected revision in ${root}`);
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=no'), '', `Tracked changes in ${root}`);
  return wanted;
};

const contracts = `#nullable enable
namespace System.Runtime.CompilerServices
{
    public sealed class UnionAttribute : System.Attribute { }
    public interface IUnion { object? Value { get; } }
}
`;

function ordinarySource(units) {
  return Array.from({ length: units }, (_, index) => `
public class Ordinary${index}
{
    public static int Pick(int value) => value + 1;
    public static long Pick(long value) => value + 2;
    public static long Convert(int value)
    {
        long wide = value;
        return Pick(value) + Pick(wide);
    }
    public static int Match(object value) => value switch { int number => number, string text => text.Length, _ => -1 };
}`).join('\n');
}

function unionSource(units, explicit) {
  return contracts + Array.from({ length: units }, (_, index) => {
    const name = `Value${index}`;
    const declaration = explicit ? `
[System.Runtime.CompilerServices.Union]
public struct ${name} : System.Runtime.CompilerServices.IUnion
{
    public ${name}(int value) { Value = value; }
    public ${name}(string value) { Value = value; }
    public object? Value { get; }
}` : `public union ${name}(int, string);`;
    const construct = value => explicit ? `new ${name}(${value})` : value;
    const operand = explicit ? 'value.Value' : 'value';
    return declaration + `
public class UnionUse${index}
{
    public static ${name} FromNumber(int value) => ${construct('value')};
    public static ${name} FromText(string value) => ${construct('value')};
    public static int Match(${name} value) => ${operand} switch { int number => number, string text => text.Length, _ => -1 };
}`;
  }).join('\n');
}

function cases(units, candidate) {
  const options = { langVersion: 'preview', outputKind: 'library', includeDebug: false, deterministic: true, name: 'UnionBenchmark' };
  const result = [{ name: 'ordinaryPreview', source: ordinarySource(units), options }];
  if (candidate) result.push(
    { name: 'explicitLowering', source: unionSource(units, true), options },
    { name: 'unionSyntax', source: unionSource(units, false), options },
  );
  return result;
}

function compileSample(compile, item) {
  globalThis.gc();
  const before = process.memoryUsage();
  const start = performance.now();
  let result = compile(item.source, item.options);
  const ms = performance.now() - start;
  const after = process.memoryUsage();
  assert.equal(result.success, true, `${item.name}: ${JSON.stringify(result.diagnostics)}`);
  const bytes = result.assembly.byteLength;
  const hash = digest(result.assembly);
  result = null;
  globalThis.gc();
  const retained = process.memoryUsage();
  return {
    ms, assemblyBytes: bytes, assemblySha256: hash,
    heapGrowthBytes: after.heapUsed - before.heapUsed,
    heapRetainedBytes: retained.heapUsed - before.heapUsed,
    rssAfterBytes: after.rss, peakRssKiB: process.resourceUsage().maxRSS,
  };
}

async function worker() {
  assert.equal(typeof globalThis.gc, 'function', 'Workers require --expose-gc');
  const root = resolve(option('root'));
  const revision = pinned(root, option('revision'));
  const candidate = option('side') === 'candidate';
  const units = integer('units', 12, 1, 100);
  const warmup = integer('warmup', 3, 1, 20);
  const pair = integer('pair', 0, 0, 199);
  const { compileToAssembly } = await import(pathToFileURL(join(root, 'packages/compiler/src/emit/cil/compile-assembly.js')));
  const workload = cases(units, candidate);
  if (pair % 2) workload.reverse();
  const samples = {};
  for (const item of workload) {
    for (let count = 0; count < warmup; count++) {
      const result = compileToAssembly(item.source, item.options);
      assert.equal(result.success, true, `${item.name} warmup: ${JSON.stringify(result.diagnostics)}`);
    }
    samples[item.name] = {
      ...compileSample(compileToAssembly, item),
      sourceBytes: Buffer.byteLength(item.source), sourceSha256: digest(item.source),
    };
  }
  assert.equal(pinned(root, revision), revision, 'Checkout changed while measuring');
  process.stdout.write(JSON.stringify({ revision, samples }));
}

const percentile = (values, fraction) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
};
const distribution = values => ({
  median: percentile(values, 0.5), p95: percentile(values, 0.95), min: Math.min(...values), max: Math.max(...values),
});
function summarize(samples) {
  const first = samples[0];
  for (const row of samples) {
    assert.equal(row.sourceSha256, first.sourceSha256, 'Workload source changed');
    assert.equal(row.assemblyBytes, first.assemblyBytes, 'Artifact size changed within a workload');
  }
  return {
    samples: samples.length, sourceBytes: first.sourceBytes, sourceSha256: first.sourceSha256,
    assemblyBytes: first.assemblyBytes,
    ms: distribution(samples.map(row => row.ms)),
    heapGrowthBytes: distribution(samples.map(row => row.heapGrowthBytes)),
    heapRetainedBytes: distribution(samples.map(row => row.heapRetainedBytes)),
    rssAfterBytes: distribution(samples.map(row => row.rssAfterBytes)),
    peakRssKiB: distribution(samples.map(row => row.peakRssKiB)),
  };
}

function pairedComparison(before, after) {
  assert.equal(before.length, after.length);
  const medianBefore = percentile(before.map(row => row.ms), 0.5);
  const medianAfter = percentile(after.map(row => row.ms), 0.5);
  return {
    medianRatio: medianAfter / medianBefore,
    medianChangePercent: (medianAfter / medianBefore - 1) * 100,
    pairedRatios: distribution(before.map((row, index) => after[index].ms / row.ms)),
    artifactChangePercent: (after[0].assemblyBytes / before[0].assemblyBytes - 1) * 100,
    exceedsTimeBudget: medianAfter / medianBefore > 1.05,
    exceedsArtifactBudget: after[0].assemblyBytes / before[0].assemblyBytes > 1.10,
  };
}

function run() {
  const pairs = integer('pairs', 20, 5, 200);
  const warmup = integer('warmup', 3, 1, 20);
  const units = integer('units', 12, 1, 100);
  assert(option('base-root') && option('base-revision') && option('candidate-root') && option('candidate-revision'),
    'Both existing checkout roots and exact revisions are required');
  const roots = { base: resolve(option('base-root')), candidate: resolve(option('candidate-root')) };
  assert.notEqual(roots.base, roots.candidate, 'Provide two existing checkouts');
  const revisions = {
    base: pinned(roots.base, option('base-revision')),
    candidate: pinned(roots.candidate, option('candidate-revision')),
  };
  const raw = { base: { ordinaryPreview: [] }, candidate: { ordinaryPreview: [], explicitLowering: [], unionSyntax: [] } };
  const order = [];
  const started = new Date().toISOString();
  for (let pair = 0; pair < pairs; pair++) {
    for (const side of pair % 2 ? ['candidate', 'base'] : ['base', 'candidate']) {
      const args = ['--expose-gc', '--max-old-space-size=2048', ownPath, '--worker', '--root', roots[side],
        '--revision', revisions[side], '--side', side, '--pair', String(pair), '--units', String(units), '--warmup', String(warmup)];
      const result = spawnSync(process.execPath, args, {
        cwd: roots[side], encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `${side} pair ${pair}: ${result.stderr || result.stdout}`);
      const row = JSON.parse(result.stdout);
      assert.equal(row.revision, revisions[side]);
      for (const [name, sample] of Object.entries(row.samples)) raw[side][name].push(sample);
      order.push({ pair, side });
    }
  }
  for (const side of ['base', 'candidate']) pinned(roots[side], revisions[side]);
  assert.equal(raw.base.ordinaryPreview[0].sourceSha256, raw.candidate.ordinaryPreview[0].sourceSha256);
  const summary = Object.fromEntries(Object.entries(raw).map(([side, rows]) =>
    [side, Object.fromEntries(Object.entries(rows).map(([name, samples]) => [name, summarize(samples)]))]));
  process.stdout.write(JSON.stringify({
    schemaVersion: 1, started, finished: new Date().toISOString(), revisions, pairs, warmup, units,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, totalMemoryBytes: totalmem(), sharedHost: true },
    scope: 'Direct CIL compileToAssembly only; no source VM, runtime, Roslyn, native, browser or Wasm performance claim.',
    method: 'Fresh sequential worker per side and pair; warm each workload; alternate sides and candidate workload order; GC before timing.',
    memoryNotes: 'Heap growth and retained heap are GC-sensitive proxies, not allocation counts. Peak RSS includes imports and warmups.',
    comparisonNotes: 'The ordinary source is identical. Candidate union syntax versus explicit lowering measures new-feature cost, not a baseline regression.',
    summary,
    ordinaryRegression: pairedComparison(raw.base.ordinaryPreview, raw.candidate.ordinaryPreview),
    candidateUnionCost: pairedComparison(raw.candidate.explicitLowering, raw.candidate.unionSyntax),
    order, raw,
  }, null, 2) + '\n');
}

if (process.argv.includes('--worker')) await worker();
else run();
