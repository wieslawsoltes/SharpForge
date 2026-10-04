import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NativeWorkspace } from '../src/workspace.js';
import { NativeMSBuild } from '../src/engine.js';
import { discoverSdkEnvironment } from '../src/sdk-discovery.js';
import { createQualificationFixtures } from './fixtures.js';
import { verifyBuildOutputs, verifyExpectedFailure } from './verify-outputs.js';
import { qualifySolutions } from './solutions.js';
import { windowsQualificationCells, qualifyWindowsMSBuild } from './windows.js';

async function qualifyAction(engine, action, framework) {
  const startedAt = performance.now();
  const started = await engine.start({ project: 'App/App.csproj', action, trusted: true,
    restore: action !== 'restore', binaryLog: true });
  const result = await engine.wait(started.id);
  let error = result.error;
  let verifiedOutputs = [];
  try {
    if (result.status !== 'succeeded') throw new Error('Native action failed');
    verifiedOutputs = await verifyBuildOutputs(engine.workspace.root, action, framework);
  } catch (failure) { error = failure.message; }
  const negative = await engine.wait((await engine.start({ project: 'Failure/Failure.csproj', action, trusted: true })).id);
  try { verifyExpectedFailure(negative); }
  catch (failure) { error = [error, failure.message].filter(Boolean).join('; '); }
  return { action, status: error ? 'failed' : 'passed', durationMs: performance.now() - startedAt,
    error, verifiedOutputs, diagnostics: result.diagnostics, failureDiagnostics: negative.diagnostics,
    artifacts: result.artifacts, invocation: result.invocation, failureInvocation: negative.invocation };
}

function sourceRevision() {
  const cwd = fileURLToPath(new URL('../../..', import.meta.url));
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    return { commit, dirty: Boolean(dirty) };
  } catch (error) { return { commit: null, error: 'Source revision unavailable: ' + error.message }; }
}

async function qualifySdk(executable, sdk, includeSolutions) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-msbuild-qualification-'));
  const fixture = await createQualificationFixtures(root, sdk);
  const workspace = await NativeWorkspace.open(root);
  const engine = new NativeMSBuild(workspace, { executable, trusted: true });
  try {
    const selectedEnvironment = await discoverSdkEnvironment({ executable, cwd: root });
    const capability = await engine.probe();
    const actions = [];
    for (const action of ['restore', 'build', 'pack', 'publish']) actions.push(await qualifyAction(engine, action, fixture.framework));
    const solutions = includeSolutions ? await qualifySolutions(engine, { msbuildVersion: capability.version }) : [];
    const standalone = await qualifyWindowsMSBuild(workspace, { framework: fixture.framework });
    const results = [...actions, ...solutions, standalone];
    const status = results.some(cell => cell.status === 'failed') ? 'failed' :
      solutions.some(cell => cell.status === 'unsupported') ? 'partial' : 'passed';
    return { sdk, engine: 'dotnet', root, selectedEnvironment, capability, actions, solutions, standalone, status };
  } finally { await engine.close(); }
}

/** Execute real SDK fixtures. Exact version pins use global.json with rollForward disabled. */
export async function runNativeQualification(options = {}) {
  const { executable = 'dotnet', outputPath = null, includeSolutions = true, sdkVersions = null } = options;
  if (sdkVersions && (!Array.isArray(sdkVersions) || !sdkVersions.length || sdkVersions.length > 16 ||
    sdkVersions.some(version => !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)))) throw new Error('Invalid SDK version matrix');
  const inventory = await discoverSdkEnvironment({ executable });
  const cells = [];
  const selections = sdkVersions ?? ['latest-stable', 'latest-preview'];
  const source = sourceRevision();
  for (const platform of ['win32', 'linux', 'darwin']) for (const selection of selections) {
    const sdk = sdkVersions ? inventory.sdks.find(item => item.version === selection) :
      inventory.sdks.filter(item => item.preview === (selection === 'latest-preview')).at(-1);
    if (platform !== process.platform || !sdk) {
      cells.push({ platform, selection, status: 'skipped',
        reason: platform !== process.platform ? 'Operating system unavailable' : 'SDK selection not installed' });
      continue;
    }
    cells.push({ platform, selection, ...await qualifySdk(executable, sdk, includeSolutions) });
  }
  const report = { version: 1, recordedAt: new Date().toISOString(), node: process.version, architecture: process.arch,
    source, inventory, cells, windows: windowsQualificationCells(), native: true,
    measurements: 'Action timings include positive and negative fixtures; no comparative speedup or allocation claim' };
  if (outputPath) await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runNativeQualification({ executable: process.env.SHARPFORGE_DOTNET ?? 'dotnet', outputPath: process.argv[2],
    sdkVersions: process.env.SHARPFORGE_QUALIFY_SDKS?.split(',').map(version => version.trim()) });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.cells.some(cell => cell.status === 'failed')) process.exitCode = 1;
}
