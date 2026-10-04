/**
 * Paired UTF-8 literal compilation and a matched no-literal control. Each revision owns its package links and symbols.
 * Run through scripts/limited.js with --expose-gc, --baseline <checkout> and --output <raw-report.json>.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, totalmem } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';

const baselineCommit = 'bf85020e6024cdd679a0234d9f050ca7dedddf53';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');

function argument(name, fallback = null) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function count(name, fallback) {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('--' + name + ' must be an integer from 1 to 1000');
  return value;
}

function source(literals) {
  const declarations = [];
  for (let index = 0; index < 48; index++) {
    const text = 'SharpForge UTF-8 é λ 😀 ' + 'abcdefgh'.repeat(4) + (index % 12);
    declarations.push('public static ReadOnlySpan<byte> Text' + index + '() => ' + (literals ? JSON.stringify(text) + 'u8' : 'default') + ';');
  }
  return 'using System; public static class Utf8Benchmark {\n' + declarations.join('\n') + '\n}';
}

function git(checkout, ...args) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', timeout: 10_000 }).trim();
}

const baseline = argument('baseline');
if (!baseline) throw new Error('An exact --baseline checkout is required.');
const expectedBaseline = argument('baseline-sha', baselineCommit);
if (!/^[0-9a-f]{40}$/.test(expectedBaseline)) throw new Error('--baseline-sha must be a complete Git commit ID.');
const warmup = count('warmup', 80);
const samples = count('samples', 24);
const options = { name: 'Utf8Benchmark', outputKind: 'library', langVersion: '11', portablePdb: false };
const fixtures = new Map([['utf8', source(true)], ['noUtf8', source(false)]]);
const pack = locateReferencePack();
if (!pack) throw new Error('A real .NET reference pack is required; set DOTNET_ROOT.');
const images = readReferenceFiles(pack.files);

async function compiler(name, checkout) {
  const require = createRequire(resolve(checkout, 'package.json'));
  const entry = require.resolve('@sharpforge/compiler');
  const local = relative(checkout, entry);
  if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) {
    throw new Error('Compiler workspace resolved outside its selected revision: ' + entry);
  }
  const commit = git(checkout, 'rev-parse', 'HEAD');
  if (name === 'baseline' && commit !== expectedBaseline) throw new Error('Baseline checkout does not match its specified commit.');
  const library = await import(pathToFileURL(entry).href);
  // Identical PE bytes are decoded separately by each revision into its own symbol classes, outside the measured work.
  return { name, commit, library, references: library.createReferenceSet(images) };
}

const revisions = [await compiler('baseline', resolve(baseline)), await compiler('current', root)];
const cases = [];
for (const revision of revisions) for (const mode of ['registry', 'cachedReferences']) for (const fixture of fixtures.keys()) {
  cases.push({ revision, mode, fixture, options: { ...options, ...(mode === 'cachedReferences' ? { references: revision.references } : {}) },
    assemblyBytes: null, warmupMs: [], samples: [] });
}

function compile(entry, measured) {
  const before = process.memoryUsage();
  const start = performance.now();
  const result = entry.revision.library.compileToAssembly(fixtures.get(entry.fixture), entry.options);
  const elapsedMs = performance.now() - start;
  const after = process.memoryUsage();
  if (!result.assembly || result.diagnostics.some(item => item.severity === 'error')) {
    throw new Error(entry.revision.name + '/' + entry.mode + '/' + entry.fixture + ': ' + JSON.stringify(result.diagnostics));
  }
  if (entry.assemblyBytes !== null && entry.assemblyBytes !== result.assembly.length) throw new Error('Non-deterministic assembly size.');
  entry.assemblyBytes = result.assembly.length;
  if (measured) entry.samples.push({ elapsedMs, heapDeltaBytes: after.heapUsed - before.heapUsed,
    arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers });
  else entry.warmupMs.push(elapsedMs);
}

function round(index, measured) {
  for (let offset = 0; offset < cases.length; offset++) compile(cases[(index + offset) % cases.length], measured);
}

for (let index = 0; index < warmup; index++) round(index, false);
global.gc?.();
const retainedBefore = process.memoryUsage();
for (let index = 0; index < samples; index++) round(index, true);
global.gc?.();
const retainedAfter = process.memoryUsage();

function summarize(entry) {
  const times = entry.samples.map(sample => sample.elapsedMs).sort((left, right) => left - right);
  const center = Math.floor(times.length / 2);
  return { revision: entry.revision.name, commit: entry.revision.commit, mode: entry.mode, fixture: entry.fixture,
    medianMs: times.length % 2 ? times[center] : (times[center - 1] + times[center]) / 2,
    p95Ms: times[Math.ceil(times.length * 0.95) - 1], assemblyBytes: entry.assemblyBytes,
    warmupMs: entry.warmupMs, samples: entry.samples };
}

const report = {
  benchmark: 'SF-A02-T77 UTF-8 static data and no-literal compilation control', generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, memoryBytes: totalmem(), explicitGc: typeof global.gc === 'function' },
  fixtures: [...fixtures].map(([name, text]) => ({ name, sha256: sha256(text), bytes: Buffer.byteLength(text),
    methods: 48, distinctLiterals: name === 'utf8' ? 12 : 0 })),
  options, referencePack: { version: pack.version, targetFramework: pack.targetFramework, assemblies: pack.files.length },
  methodology: { warmup, samples, order: 'All eight cases warmed and interleaved; each round rotates the first case by one.',
    references: 'Cached-reference compilation excludes reading, decoding and initial cross-assembly binding.',
    allocationNote: 'Heap and ArrayBuffer deltas include natural GC; they are not allocation counters. Native tests count literal allocations.',
    scope: 'Exact compiler revisions with only the UTF-8 feature and qualification changes between them.' },
  interveningCommits: git(root, 'log', '--format=%H %s', revisions[0].commit + '..' + revisions[1].commit).split('\n'),
  retainedAcrossMeasuredRounds: { heapDeltaBytes: retainedAfter.heapUsed - retainedBefore.heapUsed,
    arrayBufferDeltaBytes: retainedAfter.arrayBuffers - retainedBefore.arrayBuffers },
  results: cases.map(summarize),
};
const output = argument('output');
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(output ? { output, baseline: revisions[0].commit, current: revisions[1].commit,
  results: report.results.map(({ samples: raw, warmupMs: rawWarmup, ...result }) => result) } : report, null, 2) + '\n');
