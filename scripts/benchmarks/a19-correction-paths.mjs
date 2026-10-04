import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, realpathSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { benchmark, plan, sha256, jsonHash, parseArguments, summarize, validateReport, compareReports } from './a19-correction-report.mjs';
import { createWorkload } from './a19-correction-workloads.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const modules = ['a19-correction-paths.mjs', 'a19-correction-report.mjs', 'a19-correction-workloads.mjs'];
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

function sourceIdentity(root) {
  if (realpathSync(git(root, ['rev-parse', '--show-toplevel'])) !== root) throw new Error('--checkout must name a checkout root');
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Tracked checkout content is dirty');
  const untrackedPaths = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  return { revision: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), trackedClean: true, untrackedPaths };
}

function environment() {
  const processors = cpus();
  return { node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch,
    cpu: [...new Set(processors.map(processor => processor.model))].join('; '), logicalCpus: processors.length,
    execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? '' };
}

function harnessIdentity() {
  const files = modules.map(path => ({ path, sha256: sha256(readFileSync(join(directory, path))) }));
  return { sha256: jsonHash(files), files };
}

function packageEntries(root) {
  const packages = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => ({ directory: join(root, 'packages', entry.name), manifest: readJson(join(root, 'packages', entry.name, 'package.json')) }));
  const byName = new Map(packages.map(entry => [entry.manifest.name, entry]));
  const entries = {};
  const check = (importer, name) => {
    const entry = realpathSync(createRequire(importer).resolve(name));
    const local = relative(realpathSync(byName.get(name).directory), entry);
    if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) {
      throw new Error(`${name} resolves outside this checkout from ${importer}; prepare own workspace package links`);
    }
    git(root, ['ls-files', '--error-unmatch', '--', relative(root, entry)]);
    return entry;
  };
  for (const [name, entry] of byName) {
    entries[name] = check(join(root, 'apps/studio/workbench/studio-projects.js'), name);
    for (const dependency of Object.keys(entry.manifest.dependencies ?? {})) {
      if (byName.has(dependency)) check(join(entry.directory, 'package.json'), dependency);
    }
  }
  return entries;
}

async function loadApi(root, entries) {
  const load = path => {
    git(root, ['ls-files', '--error-unmatch', '--', relative(root, path)]);
    return import(pathToFileURL(path).href);
  };
  const editor = await load(entries['@sharpforge/editor']);
  const projects = await load(entries['@sharpforge/project-system']);
  const documents = await load(join(root, 'apps/studio/workbench/documents.js'));
  const studio = await load(join(root, 'apps/studio/workbench/studio-projects.js'));
  const runtime = await load(join(root, 'apps/studio/workers/runtime-activity.js'));
  return { EditorModel: editor.EditorModel, KeybindingService: editor.KeybindingService,
    ProjectSystem: projects.ProjectSystem, createCsproj: projects.createCsproj,
    DocumentService: documents.DocumentService, StudioProjects: studio.StudioProjects, RuntimeActivity: runtime.RuntimeActivity };
}

function measure(workload, operations) {
  let last;
  const started = process.hrtime.bigint();
  for (let index = 0; index < operations; index++) last = workload.operation();
  const elapsed = Number(process.hrtime.bigint() - started);
  workload.verify(last);
  return { nanoseconds: elapsed, result: last };
}

function failure(error, scope) {
  return { scope, name: error.name, message: error.message, stack: error.stack ?? null };
}

function timeoutCount() {
  return process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;
}

function verifyTimeoutCount(row, phase) {
  row.nativeTimeouts[phase] = timeoutCount();
  if (row.nativeTimeouts[phase] !== row.nativeTimeouts.before) throw new Error(`Native Timeout resources changed during ${phase}`);
}

async function captureCase(api, specification, failures) {
  const row = { id: specification.id, operations: specification.operations,
    firstOperationNs: null, warmupBatchNs: [], sampleBatchNs: [], passed: false,
    nativeTimeouts: { before: timeoutCount(), afterOperations: null, afterTurn: null, afterDispose: null } };
  let workload;
  let last;
  const sample = operations => {
    const observation = measure(workload, operations);
    last = observation.result;
    return observation.nanoseconds;
  };
  try {
    workload = createWorkload(api, specification);
    row.fixtureSha256 = jsonHash(workload.fixture);
    row.correctnessSha256 = workload.correctnessSha256;
    row.firstOperationNs = sample(1);
    for (let index = 0; index < plan.warmups; index++) row.warmupBatchNs.push(sample(specification.operations));
    for (let index = 0; index < plan.samples; index++) row.sampleBatchNs.push(sample(specification.operations));
    verifyTimeoutCount(row, 'afterOperations');
    await setImmediate();
    workload.verify(last);
    verifyTimeoutCount(row, 'afterTurn');
    row.summary = summarize(row.sampleBatchNs, specification.operations);
    row.passed = true;
  } catch (error) {
    failures.push(failure(error, specification.id));
  } finally {
    try { workload?.dispose(); verifyTimeoutCount(row, 'afterDispose'); }
    catch (error) { row.passed = false; failures.push(failure(error, `${specification.id}:dispose`)); }
  }
  return row;
}

async function capture(checkout) {
  const report = { schemaVersion: 1, benchmark, plan, harness: harnessIdentity(), environment: environment(),
    checkout: resolve(checkout), executable: process.execPath, argv: process.argv.slice(2),
    startedAt: new Date().toISOString(), source: null, cases: [], failures: [], passed: false };
  try {
    const root = realpathSync(checkout);
    report.checkout = root;
    report.source = sourceIdentity(root);
    const entries = packageEntries(root);
    report.packageEntries = Object.fromEntries(Object.entries(entries)
      .map(([name, path]) => [name, relative(root, path).split(sep).join('/')]));
    const api = await loadApi(root, entries);
    for (const specification of plan.cases) report.cases.push(await captureCase(api, specification, report.failures));
    if (jsonHash(sourceIdentity(root)) !== jsonHash(report.source)) throw new Error('Checkout changed during capture');
    if (jsonHash(harnessIdentity()) !== jsonHash(report.harness)) throw new Error('Harness changed during capture');
    report.passed = report.failures.length === 0;
    if (report.passed) validateReport(report);
  } catch (error) {
    report.passed = false;
    report.failures.push(failure(error, 'setup-or-integrity'));
  }
  report.completedAt = new Date().toISOString();
  return report;
}

const settings = parseArguments(process.argv.slice(2));
const output = resolve(settings.output);
if (existsSync(output)) throw new Error(`Preserve existing evidence; choose a new output path: ${output}`);
let report;
try {
  report = settings.mode === 'capture' ? await capture(settings.checkout)
    : compareReports(readJson(settings.baseline), readJson(settings.candidate));
} catch (error) {
  report = { schemaVersion: 1, benchmark, comparable: false, failures: [failure(error, 'comparison')], inputs: settings };
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, passed: report.passed, comparable: report.comparable, reviewRequired: report.reviewRequired }));
process.exitCode = settings.mode === 'capture' ? report.passed ? 0 : 1 : !report.comparable ? 1 : report.reviewRequired ? 2 : 0;
