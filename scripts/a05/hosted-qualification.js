import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {npmCli} from '../conformance/node-tools.js';
import {hostedPlan, validateHostedPlan, hostedResources, hostedRunner, hostedQueueMinutes} from './hosted-plan.js';
import {hostedEnvironment} from './hosted-environment.js';
import {aggregateHostedResults} from './hosted-results.js';
import {artifactInventory, readJson, requireOutside, sourceIdentity, writeJson, sha256} from './hosted-provenance.js';
import {runHostedProcess, withHostedBudget} from './hosted-process.js';
import {markUnfinished, runHostedQueue} from './hosted-queue.js';

const product = fileURLToPath(new URL('../../', import.meta.url));
const resources = () => ({...hostedResources, NODE_OPTIONS: process.env.NODE_OPTIONS ?? null});

function initialize(directory, reference) {
  requireOutside(product, directory);
  requireOutside(product, reference);
  requireOutside(directory, reference);
  requireOutside(reference, directory);
  if (directory === reference || existsSync(directory) || existsSync(reference)) {
    throw new Error('New, separate evidence and reference paths are required');
  }
  mkdirSync(directory, {recursive: true});
  const expectedCommit = process.env.GITHUB_SHA;
  const journal = {format: 'SharpForge.HostedA05Qualification/1', expectedCommit, directory, reference, product,
    runner: hostedRunner, resources: resources(), createdAt: new Date().toISOString(), status: 'initialized',
    scope: 'Independent hosted series. No retries or row splicing; local reports remain separate.',
    queueMinutes: hostedQueueMinutes,
    command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
    commands: hostedPlan(directory, reference).map(command => ({...command, status: 'pending'})),
    dependencies: {status: 'pending'}};
  writeJson(join(directory, 'journal.json'), journal);
  writeJson(join(directory, 'environment-initial.json'), hostedEnvironment());
  if (process.version !== 'v24.19.0') throw new Error('Hosted qualification requires exactly Node v24.19.0');
  journal.sourceInitial = sourceIdentity(product, expectedCommit, false);
  journal.orchestrationSources = ['hosted-plan', 'hosted-qualification', 'hosted-queue', 'hosted-results',
    'hosted-process', 'hosted-environment', 'hosted-provenance', 'hosted-reference-check', 'hosted-reference-worker', 'hosted-memory-results']
    .map(name => ({path: `scripts/a05/${name}.js`,
    sha256: sha256(readFileSync(join(product, 'scripts/a05', name + '.js')))}));
  writeJson(join(directory, 'journal.json'), journal);
}

async function install(context) {
  const {journal, directory, save} = context;
  if (journal.dependencies.status !== 'pending') throw new Error('Dependency setup must not be repeated');
  const executable = npmCli();
  if (!executable) throw new Error('npm CLI is unavailable');
  const argv = [executable, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  journal.dependencies = {status: 'running', command: [process.execPath, ...argv], cwd: product, resources: resources()};
  save();
  journal.dependencies.process = await withHostedBudget(journal.createdAt, signal => runHostedProcess({argv, cwd: product, signal,
    env: {...process.env, ...hostedResources}, log: join(directory, 'npm-ci.log')}));
  journal.dependencies.status = journal.dependencies.process.cancelled ? 'interrupted' :
    journal.dependencies.process.exitCode === 0 ? 'completed' : 'failed';
  save();
  if (journal.dependencies.status !== 'completed') throw new Error('npm ci failed; no timings may run');
  journal.sourceInstalled = sourceIdentity(product, journal.expectedCommit);
  save();
}

async function executeWithinBudget(context, signal) {
  const {journal, save} = context;
  journal.status = 'running';
  journal.startedAt = new Date().toISOString();
  save();
  try {
    await runHostedQueue({...context, signal});
    journal.status = signal.aborted ? 'interrupted' : 'completed';
    if (signal.aborted) journal.interruption = signal.reason.message;
  } finally {
    journal.completedAt = new Date().toISOString();
    journal.aggregate = aggregateHostedResults(journal.commands);
    save();
  }
  return journal.aggregate.status === 'satisfied' ? 0 : 1;
}

async function execute(context) {
  if (context.journal.status !== 'initialized' || context.journal.dependencies.status !== 'completed') {
    throw new Error('Queue requires successful initialization/dependencies and cannot be retried');
  }
  return withHostedBudget(context.journal.createdAt, signal => executeWithinBudget(context, signal));
}

async function finalize(context) {
  const {journal, directory, save} = context;
  markUnfinished(journal);
  try { journal.sourceFinal = sourceIdentity(product, journal.expectedCommit); }
  catch (error) { journal.finalProvenanceError = {message: error.message}; }
  writeJson(join(directory, 'environment-final.json'), hostedEnvironment());
  journal.workflowSteps = Object.fromEntries(['CHECKOUT', 'NODE_SETUP', 'INITIALIZE', 'INSTALL', 'MEASURE'].map(name =>
    [name.toLowerCase(), process.env['A05_' + name + '_OUTCOME'] ?? 'unrecorded']));
  journal.aggregate = aggregateHostedResults(journal.commands);
  if (journal.finalProvenanceError || journal.provenanceFailure || journal.dependencies.status !== 'completed') {
    journal.aggregate.status = 'unmet';
  }
  journal.finalizedAt = new Date().toISOString();
  save();
  process.stdout.write(JSON.stringify(journal.aggregate) + '\n');
  return journal.aggregate.status === 'satisfied' ? 0 : 1;
}

async function main() {
  const [mode, directoryText, referenceText, ...extra] = process.argv.slice(2);
  if (!['initialize', 'install', 'run', 'finalize', 'seal'].includes(mode) || !directoryText || extra.length ||
      (mode === 'initialize') !== Boolean(referenceText)) throw new TypeError('Use initialize OUT REFERENCE, or install|run|finalize OUT');
  const directory = resolve(directoryText);
  requireOutside(product, directory);
  if (mode === 'seal') {
    const logs = process.env.A05_LOGS;
    if (!logs) throw new Error('A05_LOGS is required to seal orchestration logs');
    requireOutside(product, logs);
    return writeJson(join(directory, 'artifact-manifest.json'), {format: 'SharpForge.HostedA05Artifacts/1',
      evidence: await artifactInventory(directory), orchestration: await artifactInventory(logs)});
  }
  if (mode === 'initialize') return initialize(directory, resolve(referenceText));
  if (mode === 'finalize' && !existsSync(join(directory, 'journal.json'))) {
    mkdirSync(directory, {recursive: true});
    const reference = process.env.A05_REFERENCE ?? directory + '-reference';
    writeJson(join(directory, 'journal.json'), {format: 'SharpForge.HostedA05Qualification/1',
      expectedCommit: process.env.GITHUB_SHA, directory, product, reference, dependencies: {status: 'unavailable'},
      status: 'setup-incomplete', resources: resources(),
      commands: hostedPlan(directory, reference).map(command => ({...command, status: 'pending'}))});
  }
  const journal = readJson(join(directory, 'journal.json'));
  if (journal.directory !== directory || journal.product !== product || journal.expectedCommit !== process.env.GITHUB_SHA) {
    throw new Error('Journal does not belong to this exact product');
  }
  validateHostedPlan(journal.commands, directory, journal.reference);
  const context = {journal, directory, product, save: () => writeJson(join(directory, 'journal.json'), journal)};
  if (mode === 'install') return install(context);
  return mode === 'run' ? execute(context) : finalize(context);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main() ?? 0; }
  catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}
