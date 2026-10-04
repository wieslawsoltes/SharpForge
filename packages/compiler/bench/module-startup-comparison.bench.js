/**
 * Whole-revision module-startup comparison (SF-A02-T72).
 * node scripts/limited.js node --expose-gc packages/compiler/bench/module-startup-comparison.bench.js \
 *   --baseline PATH --candidate PATH --candidate-sha FULL_SHA --phase compile|execute
 * Each phase has 80 warmup invocations and 20 measured invocations per revision/workload, grouped as ABBA blocks.
 */
import { readFileSync } from 'node:fs';
import { cpus, platform, arch, totalmem, freemem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import {
  loadModuleStartupCheckout, moduleStartupCheckoutProvenance, verifyModuleStartupCheckout,
} from './module-startup-benchmark-checkouts.js';
import {
  moduleBenchmarkHash, moduleBenchmarkSummary, prepareModuleStartupArtifact,
  measureModuleStartupCompile, measureModuleStartupExecution,
} from './module-startup-benchmark-measure.js';
import { moduleStartupWorkloads } from './module-startup-benchmark-workloads.js';

function readOptions() {
  const args = process.argv.slice(2);
  const numeric = { warmup: [80, 20, 200], samples: [20, 20, 100], 'budget-ms': [180000, 10000, 600000], 'timeout-ms': [10000, 1000, 60000] };
  const names = new Set(['baseline', 'candidate', 'candidate-sha', 'phase', 'references', ...Object.keys(numeric)]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].slice(2);
    if (!args[index].startsWith('--') || !names.has(name) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`Unknown option or missing value: ${args[index]}`);
    if (Object.hasOwn(options, name)) throw new Error(`Repeated option: --${name}`);
    options[name] = args[index + 1];
  }
  for (const [name, [fallback, minimum, maximum]] of Object.entries(numeric)) {
    const value = Number(options[name] ?? fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}`);
    options[name] = value;
  }
  if (options.warmup % 2 || options.samples % 2) throw new Error('--warmup and --samples must be even for complete ABBA blocks');
  if (!['compile', 'execute'].includes(options.phase)) throw new Error('--phase must explicitly select compile or execute');
  options.references ??= 'registry';
  if (!['registry', 'pack'].includes(options.references)) throw new Error('--references must be registry or pack');
  if (typeof globalThis.gc !== 'function') throw new Error('Run this benchmark with node --expose-gc');
  return options;
}

const options = readOptions();
const startedAt = new Date().toISOString();
const deadline = performance.now() + options['budget-ms'];
const available = () => performance.now() < deadline;
const variants = [];
for (const role of ['baseline', 'candidate']) variants.push(await loadModuleStartupCheckout({
  role, suppliedRoot: options[role], candidateSha: options['candidate-sha'], references: options.references,
}));
if (variants[0].pack?.pack.directory !== variants[1].pack?.pack.directory)
  throw new Error('The two revisions did not load the same .NET reference pack');
const { workloads, reference } = moduleStartupWorkloads();
const launch = { maxInstructions: 100000, maxOutputCharacters: 256 };
const contexts = new Map();
const rows = workloads.map(fixture => {
  contexts.set(fixture.id, { fixture, artifacts: {}, variants: {} });
  return {
    id: fixture.id, sourceSha256: fixture.sourceSha256, sourceBytes: fixture.sourceBytes, pinHash: fixture.pinHash,
    expectedOutput: fixture.expected, langVersion: fixture.langVersion, status: 'pending', artifacts: {},
    warmupInvocations: { baseline: 0, candidate: 0 }, samples: { baseline: [], candidate: [] },
  };
});

function failure(row, error, stage, role) {
  row.status = available() ? 'failed' : 'incomplete';
  row.failure = { stage, role, name: error?.name ?? typeof error, message: error?.message ?? String(error) };
}

// Preflight performs the actual output checks against independent pins before timed compilation or VM execution.
for (const row of rows) {
  if (!available()) break;
  const context = contexts.get(row.id);
  for (const variant of variants) {
    if (!available()) break;
    const configured = {
      launch, timeoutMs: options['timeout-ms'],
      compile: { name: 'ModuleStartupBenchmark', langVersion: row.langVersion, includeDebug: false,
        ...(variant.pack ? { references: variant.pack.references } : {}),
      },
    };
    context.variants[variant.role] = configured;
    try {
      const prepared = prepareModuleStartupArtifact(variant, context.fixture, configured);
      context.artifacts[variant.role] = prepared.assembly;
      row.artifacts[variant.role] = prepared.description;
    } catch (error) {
      failure(row, error, 'untimed output preflight', variant.role);
      break;
    }
  }
  if (row.status === 'pending' && variants.every(variant => context.artifacts[variant.role])) row.status = 'ready';
}

function invoke(variant, row) {
  const context = contexts.get(row.id);
  const configured = context.variants[variant.role];
  return options.phase === 'compile'
    ? measureModuleStartupCompile(variant, context.fixture, configured, row.artifacts[variant.role])
    : measureModuleStartupExecution(variant, context.fixture, configured, context.artifacts[variant.role]);
}

/** A and B each have two observations per block, symmetric around the same midpoint to limit serial drift. */
function measureStage(count, measured) {
  for (let block = 0; block < count / 2; block++) {
    for (let offset = 0; offset < rows.length; offset++) {
      if (!available()) return;
      const row = rows[(block + offset) % rows.length];
      if (row.status !== 'ready') continue;
      const order = [0, 1, 1, 0];
      for (let position = 0; position < order.length; position++) {
        if (!available()) return;
        const variant = variants[order[position]];
        try {
          const sample = invoke(variant, row);
          if (measured) row.samples[variant.role].push({ block, position, ...sample });
          else row.warmupInvocations[variant.role]++;
        } catch (error) {
          failure(row, error, measured ? 'measurement' : 'warmup', variant.role);
          break;
        }
      }
    }
  }
}
measureStage(options.warmup, false);
measureStage(options.samples, true);

const change = (before, after) => before > 0 ? (after / before - 1) * 100 : null;
function summarize(samples) {
  const fields = options.phase === 'execute'
    ? ['elapsedMs', 'instructions', 'managedAllocations', 'managedAllocatedBytes', 'managedCollections', 'managedCollectionPauseMs']
    : ['elapsedMs'];
  const result = Object.fromEntries(fields.map(name => [name, moduleBenchmarkSummary(samples.map(sample => sample[name]))]));
  result.memoryDeltaBytes = Object.fromEntries(['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'].map(name =>
    [name, moduleBenchmarkSummary(samples.map(sample => sample.memory[name].deltaBytes))]));
  return result;
}

function comparison(row) {
  const ratios = [];
  for (let block = 0; block < options.samples / 2; block++) {
    const averages = variants.map(variant => {
      const samples = row.samples[variant.role].filter(sample => sample.block === block);
      if (samples.length !== 2) throw new Error('A completed ABBA block must have two observations from each revision');
      return (samples[0].elapsedMs + samples[1].elapsedMs) / 2;
    });
    ratios.push(averages[1] / averages[0]);
  }
  const baseline = row.summary.baseline.elapsedMs;
  const candidate = row.summary.candidate.elapsedMs;
  const medianChangePercent = change(baseline.median, candidate.median);
  const peSizeChangePercent = change(row.artifacts.baseline.peBytes, row.artifacts.candidate.peBytes);
  return {
    medianChangePercent, p95ChangePercent: change(baseline.p95, candidate.p95), peSizeChangePercent,
    blockMeanRatios: ratios, blockMeanRatio: moduleBenchmarkSummary(ratios),
    exceedsFivePercentMedianBudget: medianChangePercent > 5, exceedsTenPercentPeSizeBudget: peSizeChangePercent > 10,
  };
}

for (const row of rows) {
  if (row.status === 'ready') row.status = variants.every(variant =>
    row.samples[variant.role].length === options.samples && row.warmupInvocations[variant.role] === options.warmup) ? 'complete' : 'incomplete';
  if (row.status === 'pending' || row.status === 'incomplete') row.pendingReason = 'The total benchmark budget was exhausted';
  row.summary = Object.fromEntries(variants.map(variant => [variant.role, summarize(row.samples[variant.role])]));
  if (row.status === 'complete') row.comparison = comparison(row);
}
const packageNames = new Set(variants.flatMap(variant => Object.keys(variant.packageTrees)));
const productionChanges = [...packageNames].filter(name =>
  variants[0].packageTrees[name]?.source !== variants[1].packageTrees[name]?.source
  || variants[0].packageTrees[name]?.manifest !== variants[1].packageTrees[name]?.manifest);
const finalVerification = variants.map(variant => {
  try {
    const checked = verifyModuleStartupCheckout({
      role: variant.role, suppliedRoot: options[variant.role], candidateSha: options['candidate-sha'], references: options.references,
    }, variant);
    return { role: variant.role, status: 'verified', revision: checked.revision, aliases: checked.aliases };
  } catch (error) {
    return { role: variant.role, status: 'failed', name: error?.name ?? typeof error, message: error?.message ?? String(error) };
  }
});
const invalidated = finalVerification.some(check => check.status !== 'verified');
if (invalidated) for (const row of rows) {
  row.measurementStatus = row.status;
  row.status = 'invalidated';
  delete row.comparison;
}
const report = {
  benchmark: 'SF-A02-T72 whole-revision module startup', startedAt, completedAt: new Date().toISOString(),
  status: invalidated ? 'invalidated' : rows.every(row => row.status === 'complete') ? 'complete' : 'incomplete',
  settings: { phase: options.phase, warmupInvocationsPerRevision: options.warmup, measuredInvocationsPerRevision: options.samples,
    blockOrder: 'baseline,candidate,candidate,baseline', warmupBlocks: options.warmup / 2, measuredBlocks: options.samples / 2,
    references: options.references, timeoutMs: options['timeout-ms'], totalBudgetMs: options['budget-ms'], launch,
  },
  sourceHashes: Object.fromEntries(['module-startup-comparison.bench.js', 'module-startup-benchmark-checkouts.js',
    'module-startup-benchmark-measure.js', 'module-startup-benchmark-workloads.js'].map(name =>
    [name, moduleBenchmarkHash(readFileSync(fileURLToPath(new URL(name, import.meta.url))))])),
  environment: { node: process.version, v8: process.versions.v8, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtEnd: freemem(),
    heapSizeLimitBytes: getHeapStatistics().heap_size_limit, exposedGc: true, hostIsolation: 'not verified by the runner',
  },
  revisions: variants.map(moduleStartupCheckoutProvenance), finalVerification, productionChanges, reference,
  methodology: 'Separate phases; 80/20 defaults per revision and workload, ABBA blocks, rotating workloads, independent output preflight.',
  limitations: [
    'This compares whole revisions, including the intentional compiler, CIL and runtime changes; it does not isolate one helper.',
    'Only no-initializers and plain-main have comparable correct baseline outputs. Incorrect baseline library/static-field cases are excluded.',
    'Execution times a fresh CilVirtualMachine(bytes) constructor plus run(), including decode/verification and program Console.WriteLine calls.',
    'Host output checks, hashing, memory snapshots, explicit GC and stop() are outside timers. Automatic GC remains included.',
    'RSS/heap before-after deltas are scoped process proxies, not peak memory, managed allocation totals, retained leaks or isolated revision footprints.',
    'The shared process retains both imported revisions. Synchronous time limits are checked after calls; execution also has an instruction cap.',
    'Partial/failed rows retain raw observations and receive no complete comparison. Shared-host noise remains; no CLR timing is inferred.',
    'Final verification repeats exact HEAD, tracked cleanliness and transitive alias checks for both revisions; drift invalidates comparisons.',
  ],
  rows,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'complete') process.exitCode = 1;
