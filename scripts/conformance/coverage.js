import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile, readdir, realpath} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {discoverManifests, selectManifests, isMain} from '../planning/test-manifests.js';
import {packageCoverage, checkFloors, floorProposal} from './coverage/report.js';
import {git} from '../planning/lib/io.js';
const reporter = fileURLToPath(new URL('./coverage/reporter.js', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
async function save(path, value) { await mkdir(dirname(path), {recursive: true}); await writeFile(path, json(value)); }

export function runNodeCoverage({root, files, destination, timeout}) {
  return new Promise(resolveRun => {
    const args = ['--test', '--test-concurrency=1', '--experimental-test-coverage', '--test-reporter=' + reporter,
      '--test-reporter-destination=' + destination, ...files];
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT; delete env.NODE_V8_COVERAGE;
    const child = spawn(process.execPath, args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env});
    let log = '', timedOut = false, spawnError = null;
    const append = bytes => { log = (log + bytes.toString()).slice(-1024 * 1024); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { spawnError = error.message; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.on('close', (code, signal) => { clearTimeout(timer); resolveRun({code, signal, timedOut, spawnError, log, argv: [process.execPath, ...args]}); });
  });
}
export async function measureCoverage({root = process.cwd(), area, output = 'planning/qualification/coverage.json',
  artifacts = 'artifacts/coverage', floors = 'planning/qualification/coverage/floors.json', proposal,
  manifests, runner = runNodeCoverage} = {}) {
  root = await realpath(resolve(root));
  const report = {schemaVersion: 1, status: 'running', capturedAt: new Date().toISOString(), commit: null,
    engine: `node@${process.versions.node}`, platform: `${process.platform}-${process.arch}`,
    scope: 'Observed packages/*/src files per area; unimported files and browser/native execution are not measured.',
    areas: [], errors: [], qualification: 'unknown'};
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Coverage requires Node 22 or newer');
    report.commit = git(['rev-parse', 'HEAD'], root).trim();
    const selected = selectManifests(manifests ?? await discoverManifests(root), area);
    const packageNames = (await readdir(resolve(root, 'packages'), {withFileTypes: true})).filter(row => row.isDirectory()).map(row => row.name).sort();
    const policy = JSON.parse(await readFile(resolve(root, floors), 'utf8'));
    checkFloors([], policy);
    for (const manifest of selected) {
      const row = {area: manifest.area, status: 'running', packages: [], unmeasuredPackages: packageNames,
        browser: {status: 'unsupported', reason: 'Node coverage does not instrument browser scripts'},
        native: {status: 'unsupported', reason: 'Node coverage does not instrument Rust or native collectors'}};
      report.areas.push(row);
      const files = [...new Set(manifest.nodeFiles)].sort();
      row.testFiles = files; row.manifestSHA256 = createHash('sha256').update(json(files)).digest('hex');
      if (!files.length) { row.status = 'unsupported'; row.reason = 'Area has no Node tests'; continue; }
      const destination = resolve(root, artifacts, manifest.area + '.ndjson');
      await mkdir(dirname(destination), {recursive: true});
      try {
        const result = await runner({root, files, destination, timeout: manifest.timeout ?? 1200000});
        await writeFile(resolve(root, artifacts, manifest.area + '.log'), result.log);
        row.process = {...result}; delete row.process.log;
        const events = (await readFile(destination, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        const summaries = events.filter(event => event.type === 'test:coverage');
        if (summaries.length !== 1) throw new Error('Expected exactly one complete Node coverage summary');
        row.packages = packageCoverage(summaries[0].data.summary, root);
        row.unmeasuredPackages = packageNames.filter(name => !row.packages.some(value => value.package === name));
        row.failures = events.filter(event => event.type === 'test:fail').map(event => event.data);
        if (result.code !== 0 || result.timedOut || result.spawnError || row.failures.length) throw new Error('Area test process failed or did not complete');
        if (!row.packages.length) throw new Error('Area executed without any package source coverage');
        row.status = 'passed';
      } catch (error) { row.status = 'failed'; row.reason = error.message; report.errors.push(`${manifest.area}: ${error.message}`); }
    }
    report.errors.push(...checkFloors(report.areas, policy));
    report.floorStatus = policy.floors.length ? 'recorded-floors-enforced' : 'unknown-no-reviewed-measurements';
    report.status = report.errors.length ? 'failed' : 'completed';
    if (proposal && !report.errors.length) await save(resolve(root, proposal), floorProposal(report));
  } catch (error) { report.status = 'failed'; report.errors.push(error.message); }
  await save(resolve(root, output), report); // Failure reports are retained for always-upload CI steps.
  return report;
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options: {root: {type: 'string', default: '.'}, area: {type: 'string'}, output: {type: 'string'}, artifacts: {type: 'string'}, floors: {type: 'string'}, proposal: {type: 'string'}}});
  const report = await measureCoverage(values);
  console.log(JSON.stringify({status: report.status, areas: report.areas.length, errors: report.errors}));
  if (report.status === 'failed') process.exitCode = 1;
}
