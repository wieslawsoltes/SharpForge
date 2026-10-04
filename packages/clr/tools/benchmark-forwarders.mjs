import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { forwardingCorpus, forwardingContext } from '../../../tests/clr-forwarders-fixtures.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.argv[2];
if (!output) throw Error('Pass an explicit benchmark JSON output path');
const warmupBatches = 20;
const measuredBatches = 100;
const expected = Object.freeze({ fullName: 'Fixture.Widget', metadataToken: 0x02000003, assembly: 'ForwardTarget' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

async function sourceSnapshot() {
  const packages = ['packages/clr/src', 'packages/cil/src'];
  const files = ['packages/clr/tools/benchmark-forwarders.mjs', 'tests/clr-forwarders-fixtures.js',
    'tests/clr-types-graph-fixtures.js', 'tests/managed-fixtures.js', 'tests/fixtures/clr-forwarders/native-forwarders.json'];
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', ...packages, ...files]);
  if (dirty) throw Error(`Benchmark source must be committed and clean: ${dirty}`);
  const packageHashes = [];
  for (const directory of packages) {
    const paths = execFileSync('git', ['ls-files', '-z', '--', directory], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const hash = createHash('sha256');
    for (const path of paths) {
      const bytes = await readFile(resolve(root, path));
      hash.update(`${path}\0${bytes.length}\0`).update(bytes);
    }
    packageHashes.push({ directory, files: paths.length, sha256: hash.digest('hex'),
      gitTree: git(['rev-parse', `HEAD:${directory}`]) });
  }
  const sourceFiles = [];
  for (const path of files) sourceFiles.push({ path, sha256: sha256(await readFile(resolve(root, path))) });
  return { commit: git(['rev-parse', 'HEAD']), clean: true, packages: packageHashes, files: sourceFiles,
    packageHashFormat: 'Git ls-files -z order; UTF-8 path, NUL, decimal byte length, NUL, then raw file bytes' };
}

function validateResult(type, canonical) {
  if (!type || type.fullName !== expected.fullName || type.metadataToken !== expected.metadataToken || !type.isLoaded ||
      type.assembly?.identity.name !== expected.assembly || type.module !== type.assembly.manifestModule ||
      type !== type.module.typeDefinition(expected.metadataToken) || (canonical && type !== canonical)) {
    throw Error('Benchmark did not return the canonical loaded ForwardTarget Fixture.Widget TypeDef');
  }
  return type.metadataToken;
}

function summary(samples) {
  const sorted = samples.map(sample => sample.microsecondsPerOperation).sort((left, right) => left - right);
  const middle = sorted.length / 2;
  return { median: (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], p99: sorted[Math.ceil(sorted.length * 0.99) - 1] };
}

async function runBatch(operation) {
  // Keep every returned object alive through validation; only the lookup and result retention are timed.
  const returned = new Array(operation.iterations);
  const start = performance.now();
  for (let index = 0; index < operation.iterations; index++) returned[index] = await operation.run();
  const elapsedMilliseconds = performance.now() - start;
  let checksum = 0;
  for (const type of returned) checksum = (checksum + validateResult(type, operation.canonical)) >>> 0;
  return { elapsedMilliseconds, microsecondsPerOperation: elapsedMilliseconds * 1000 / operation.iterations, checksum };
}

async function measure(operation, results) {
  const result = { name: operation.name, iterations: operation.iterations, unit: 'microseconds/operation',
    warmupBatches, measuredBatches, warmups: [], samples: [], validatedOperations: 0, checksum: 0 };
  results.push(result);
  for (let batch = 0; batch < warmupBatches + measuredBatches; batch++) {
    const sample = await runBatch(operation);
    result.checksum = (result.checksum + sample.checksum) >>> 0;
    result.validatedOperations += operation.iterations;
    const collection = batch < warmupBatches ? result.warmups : result.samples;
    collection.push({ batch: collection.length, ...sample });
  }
  Object.assign(result, summary(result.samples));
}

const report = { format: 'sharpforge.clr-forwarders-benchmark', version: 1, status: 'running', startedAt: new Date().toISOString(),
  backend: 'host JavaScript CLR loader service', environment: { node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    execArgv: process.execArgv, sharedMachine: true, concurrentActivity: 'not measured', forcedGc: false },
  statistics: { median: 'arithmetic mean of the two middle ordered samples',
    percentile: 'nearest rank: ordered[ceil(n * p) - 1]', rawOrder: 'chronological per operation, warmups excluded from summaries' },
  measurement: { timing: 'awaited lookup and retaining each returned result; validation runs after each timed batch',
    cold: 'new context plus prebuilt image admission and two forwarding hops; fixture generation is outside timing',
    canonicalGuard: 'fullName, metadataToken, loaded state, defining assembly/module, canonical TypeDef object; warm identity also checked',
    allocationCounts: 'not measured', previousEquivalentImplementation: false },
  expected, results: [] };
const save = () => writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');

try {
  report.source = await sourceSnapshot();
  const images = forwardingCorpus();
  report.fixtures = [...images].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) }));
  report.usedImages = ['ForwardFacade', 'ForwardBridge', 'ForwardTarget'];
  report.imageBytes = report.fixtures.filter(image => report.usedImages.includes(image.name)).reduce((sum, image) => sum + image.bytes, 0);
  const context = forwardingContext(images);
  const facade = await context.loadFromAssemblyName('ForwardFacade');
  const target = await context.loadFromAssemblyName('ForwardTarget');
  const canonical = await context.types.find(target.manifestModule, expected.fullName);
  validateResult(canonical);
  await save();
  const operations = [
    { name: 'cold context, image admission and two forwarding hops', iterations: 5, run: async () => {
      const local = forwardingContext(images);
      const assembly = await local.loadFromAssemblyName('ForwardFacade');
      return local.types.find(assembly.manifestModule, expected.fullName);
    } },
    { name: 'warm two-hop forwarded type lookup', iterations: 100, canonical,
      run: () => context.types.find(facade.manifestModule, expected.fullName) },
    { name: 'warm direct definition name lookup', iterations: 100, canonical,
      run: () => context.types.find(target.manifestModule, expected.fullName) },
  ];
  for (const operation of operations) {
    await measure(operation, report.results);
    await save();
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ status: report.status, source: report.source?.commit,
  results: report.results.map(({ warmups, samples, ...result }) => result), error: report.error }));
