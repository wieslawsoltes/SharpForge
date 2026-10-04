import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitRepository, cloneRepository, createHttpTransport, getObjectFormat, checkCancelled } from '@sharpforge/git';
import { openNodeRepository, initNodeRepository } from '@sharpforge/git/node';
import { generateBenchmarkRepository } from './generate.js';
import { startGitHttpFixture } from './git-http-fixture.js';
import { CountingObjectDatabase, measureOperation, directoryStatistics, compareBenchmarkBaseline } from './metrics.js';
import { benchmarkReadOperations } from './read-operations.js';
import { createBenchmarkReport, recordBenchmarkSample, BenchmarkFailure, writeBenchmarkReport } from './report.js';

export const LARGE_REPOSITORY_PROFILE = Object.freeze({ files: 100_000, binaryBytes: 1024 ** 3, history: 20, samples: 3, algorithm: 'sha1' });

function validateProfile(options) {
  const profile = Object.fromEntries(Object.entries(LARGE_REPOSITORY_PROFILE).map(([key, value]) => [key, options[key] ?? value]));
  for (const [key, minimum, maximum] of [['files', 1, 200000], ['binaryBytes', 0, 2 * 1024 ** 3], ['history', 1, 100], ['samples', 1, 30]]) {
    if (!Number.isSafeInteger(profile[key]) || profile[key] < minimum || profile[key] > maximum) throw new Error(`Invalid benchmark ${key}`);
  }
  profile.algorithm = getObjectFormat(profile.algorithm).name;
  return profile;
}

async function openMeasuredRepository(directory, profile, { initialize = false, signal } = {}) {
  checkCancelled(signal);
  const descriptor = await (initialize ? initNodeRepository : openNodeRepository)({ directory, algorithm: profile.algorithm, signal });
  const odb = new CountingObjectDatabase(descriptor.odb);
  const repo = new GitRepository({ ...descriptor, odb });
  try { await repo.init({ signal }); }
  catch (error) {
    repo.dispose();
    await descriptor.store.close();
    throw error;
  }
  return {
    repo, descriptor, counters: odb.counters,
    close: async () => { repo.dispose(); repo.history?.dispose(); await descriptor.store.close(); }
  };
}

async function cloneSample(root, fixture, server, profile, sample, options) {
  const directory = join(root, `clone-${sample}`);
  const opened = await openMeasuredRepository(directory, profile, { initialize: true, signal: options.signal });
  const transport = createHttpTransport({ origins: [server.origin], allowInsecureLocalhost: true, timeoutMs: 30 * 60_000 });
  try {
    const measurement = await measureOperation(async () => {
      const repo = opened.repo;
      const result = await cloneRepository({
        odb: repo.odb, refs: repo.refs, config: repo.config, worktree: repo.worktree, algorithm: profile.algorithm,
        transport, url: `${server.origin}/repository.git`, signal: options.signal, maxPackBytes: 4 * 1024 ** 3,
        checkout: ({ oid }) => repo.checkout(oid, { force: true, signal: options.signal })
      });
      if (result.branch) await repo.refs.setSymbolic('HEAD', result.branch, { signal: options.signal });
      if (result.oid !== fixture.head) throw new Error('Benchmark clone did not reproduce the native fixture tip');
      return { oid: result.oid, objects: result.pack?.count ?? 0 };
    }, { counters: opened.counters, signal: options.signal });
    return { ...measurement, directory };
  } finally { await opened.close(); }
}

async function readSamples(directory, profile, report, options) {
  for (const [name, operation] of Object.entries(benchmarkReadOperations)) {
    for (let index = 0; index < profile.samples; index++) {
      const opened = await openMeasuredRepository(directory, profile, { signal: options.signal });
      try {
        for (const mode of ['cold', 'warm']) {
          options.onProgress?.({ phase: `${name}.${mode}`, sample: index + 1, total: profile.samples });
          const measured = await measureOperation(() => operation(opened.repo, profile, options), {
            counters: opened.counters, signal: options.signal
          });
          recordBenchmarkSample(report, `${name}.${mode}`, measured.sample);
        }
      } finally { await opened.close(); }
    }
  }
}

async function collectMeasurements(root, fixture, server, profile, options) {
  const { report, signal } = options;
  let directory;
  for (let index = 0; index < profile.samples; index++) {
    options.onProgress?.({ phase: 'clone', sample: index + 1, total: profile.samples });
    const measured = await cloneSample(root, fixture, server, profile, index, options);
    recordBenchmarkSample(report, 'clone', measured.sample);
    if (index) await rm(measured.directory, { recursive: true, force: true });
    else directory = measured.directory;
  }
  await readSamples(directory, profile, report, options);
  options.onProgress?.({ phase: 'storage' });
  const opened = await openMeasuredRepository(directory, profile, { signal });
  try {
    const storage = await directoryStatistics(opened.descriptor.gitDirectory, { signal });
    const objects = (await opened.repo.odb.list({ signal })).length;
    checkCancelled(signal);
    report.storage = { ...storage, objects, backend: opened.descriptor.capabilities.backend };
  } finally { await opened.close(); }
}

async function closeBenchmark(server, root, options, failures) {
  try { await server?.close(); }
  catch (error) { failures.push(error); }
  try { if (root && !options.keep) await rm(root, { recursive: true, force: true }); }
  catch (error) { failures.push(error); }
}

/** Standalone large-repository benchmark. Full data is generated only when this function is explicitly called. */
export async function runLargeRepositoryBenchmark(options = {}) {
  const profile = validateProfile(options);
  const report = createBenchmarkReport(profile);
  const parent = resolve(options.directory ?? tmpdir());
  let root;
  let server;
  const failures = [];
  const settings = { ...options, report, onProgress: event => {
    report.phase = event.phase;
    checkCancelled(options.signal);
    options.onProgress?.(event);
    checkCancelled(options.signal);
  } };
  try {
    checkCancelled(options.signal);
    await mkdir(parent, { recursive: true });
    checkCancelled(options.signal);
    root = await mkdtemp(join(parent, 'sharpforge-git-benchmark-'));
    if (options.keep) report.directory = root;
    settings.onProgress({ phase: 'generate' });
    const fixture = await generateBenchmarkRepository(root, profile, settings);
    report.machine.reference = fixture.version;
    report.fixture = { textFiles: fixture.textFiles, binaryFiles: fixture.binaryFiles,
      totalBinaryBytes: profile.binaryBytes, head: fixture.head };
    settings.onProgress({ phase: 'serve' });
    server = await startGitHttpFixture({ directory: root, env: fixture.env, timeoutMs: 30 * 60_000 });
    await collectMeasurements(root, fixture, server, profile, settings);
    settings.onProgress({ phase: 'baseline' });
    if (options.baseline) {
      const baseline = typeof options.baseline === 'string'
        ? JSON.parse(await readFile(options.baseline, { encoding: 'utf8', signal: options.signal })) : options.baseline;
      checkCancelled(options.signal);
      report.regressions = compareBenchmarkBaseline(report, baseline);
    }
  } catch (error) { failures.push(error); }
  if (!failures.length) report.phase = 'cleanup';
  await closeBenchmark(server, root, options, failures);
  report.memoryPolicy.processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  if (!failures.length) {
    try { checkCancelled(options.signal); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) {
    const failure = failures.length === 1 ? failures[0]
      : new AggregateError(failures, 'Benchmark failed and cleanup also failed', { cause: failures[0] });
    throw new BenchmarkFailure(failure, report);
  }
  report.phase = 'complete';
  report.complete = true;
  report.ok = report.regressions.length === 0;
  return report;
}

function parseOptions(argv) {
  const options = {};
  const names = { '--files': 'files', '--binary-bytes': 'binaryBytes', '--samples': 'samples', '--history': 'history',
    '--algorithm': 'algorithm', '--directory': 'directory', '--baseline': 'baseline', '--output': 'output' };
  if (argv.includes('--quick')) Object.assign(options, { files: 100, binaryBytes: 1024 * 1024, history: 4, samples: 2 });
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--quick') continue;
    if (flag === '--keep') { options.keep = true; continue; }
    if (!names[flag] || argv[index + 1] === undefined) throw new Error(`Invalid benchmark option ${flag}`);
    const value = argv[++index];
    options[names[flag]] = ['files', 'binaryBytes', 'samples', 'history'].includes(names[flag]) ? Number(value) : value;
  }
  return options;
}

export async function benchmarkMain(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: large-repo.js [--quick] [--files N] [--binary-bytes N] [--history N] [--samples N]\n'
      + '  [--algorithm sha1|sha256] [--baseline REPORT.json] [--output REPORT.json] [--directory DIR] [--keep]\n');
    return 0;
  }
  const options = parseOptions(argv);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const result = await runLargeRepositoryBenchmark({ ...options, signal: controller.signal,
      onProgress: value => process.stderr.write(`SHARPFORGE_GIT_BENCH_PROGRESS ${JSON.stringify(value)}\n`) });
    process.stdout.write(await writeBenchmarkReport(result, options.output));
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error.report) {
      try { process.stdout.write(await writeBenchmarkReport(error.report, options.output)); }
      catch (reportError) {
        throw new AggregateError([error, reportError], 'Benchmark failed and its report could not be saved', { cause: error });
      }
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await benchmarkMain();
