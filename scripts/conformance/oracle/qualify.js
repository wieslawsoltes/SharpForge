import { mkdir, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { root, oracleRoot, pin, platform, resolveToolchain, requireTarget } from './toolchain.js';
import { loadFixtures, loadFixture } from './fixtures.js';
import { compileFixture } from './roslyn-compile.js';
import { executeAssembly, runFixture } from './clr-run.js';
import { runWinUI, winuiInput } from './winui-run.js';
import { envelope, writeExpected, compareExpected, verifyStore } from './store.js';
import { runProcess } from './process.js';

export function parseArguments(args) {
  const settings = { mode: 'verify', oracle: 'all', benchmark: true };
  for (let i = 0; i < args.length; i++) {
    if (['--update', '--capture', '--verify'].includes(args[i])) {
      if (settings.explicitMode) throw new Error('Select one of --verify, --update or --capture');
      settings.mode = args[i].slice(2); settings.explicitMode = true;
    } else if (args[i] === '--oracle') settings.oracle = args[++i];
    else if (args[i] === '--no-benchmark') settings.benchmark = false;
    else throw new Error(`Unknown oracle argument ${args[i]}`);
  }
  if (!['all', 'roslyn', 'coreclr', 'winui'].includes(settings.oracle)) throw new Error('Oracle must be all, roslyn, coreclr or winui');
  return settings;
}

export function planTargets(oracle, target = platform) {
  const ids = oracle === 'all' ? ['roslyn', 'coreclr', 'winui'] : oracle === 'coreclr' ? ['roslyn', 'coreclr'] : [oracle];
  return ids.map(oracleId => ({ oracleId, ...requireTarget(oracleId, target) }));
}

export function checkFixtureContract(fixture, compileResult, runResult, target = process.platform) {
  if (fixture.execute) {
    if (compileResult.exitCode !== 0 || !compileResult.assemblySHA256 || compileResult.diagnostics.some(value => value.severity === 'error')) throw new Error(`${fixture.id} must compile successfully`);
  } else if (compileResult.exitCode !== 1 || compileResult.assemblySHA256 !== null || JSON.stringify(compileResult.diagnostics.filter(item => item.severity === 'error').map(item => item.id).sort()) !== JSON.stringify([...fixture.diagnostics].sort())) {
    throw new Error(`${fixture.id} compiler diagnostic contract failed: ${JSON.stringify(compileResult)}`);
  }
  if (runResult) {
    if (runResult.stdout.replaceAll('\r\n', '\n') !== fixture.stdout) throw new Error(`${fixture.id} stdout contract failed`);
    if (fixture.unhandledException) {
      if (runResult.unhandledException !== fixture.unhandledException || (runResult.exitCode === 0 && runResult.signal === null)) throw new Error(`${fixture.id} must produce native unhandled ${fixture.unhandledException}`);
    } else {
      const exitCode = target === 'win32' ? fixture.exitCode >>> 0 : ((fixture.exitCode % 256) + 256) % 256;
      if (runResult.exitCode !== exitCode || runResult.signal || runResult.unhandledException || runResult.stderr) throw new Error(`${fixture.id} native exit/output contract failed: ${JSON.stringify(runResult)}`);
    }
  }
}

const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
export async function benchmark(toolchain) {
  const fixture = await loadFixture({ id: 'allocation-benchmark', source: 'Allocations.cs', langVersion: '12.0' });
  const compiled = await compileFixture(fixture, toolchain);
  if (!compiled.assembly) throw new Error('Allocation benchmark did not compile');
  const times = [];
  const allocations = [];
  for (let i = 0; i < 21; i++) {
    const execution = await executeAssembly(compiled.assembly, toolchain);
    const match = execution.result.stdout.trim().match(/^(\d+)\|(\d+)$/);
    if (execution.result.exitCode !== 0 || !match || Number(match[1]) !== 124716 || Number(match[2]) < 128000) throw new Error('Allocation benchmark correctness gate failed');
    times.push(execution.elapsedMs); allocations.push(Number(match[2]));
  }
  return {
    scope: 'Fresh native CoreCLR process each sample; warm means repeated filesystem/runtime startup, not a reused JIT or process.',
    coldMs: times[0], warmMs: times.slice(1), p95Ms: percentile(times.slice(1), 0.95), p99Ms: percentile(times.slice(1), 0.99),
    managedAllocatedBytes: allocations, allocationScope: 'GC.GetAllocatedBytesForCurrentThread for 1000 byte[128] allocations, excludes host/runtime/native allocations.',
    compilerColdMs: compiled.timings[0], compilerRepeatMs: compiled.timings[1], inputHash: fixture.inputHash,
  };
}

async function checkLockedRestore(toolchain) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-oracle-restore-'));
  try {
    for (const name of ['global.json', 'NuGet.Config', 'Oracle.csproj', 'packages.lock.json']) await cp(path.join(oracleRoot, name), path.join(directory, name));
    const args = ['restore', 'Oracle.csproj', '--locked-mode', '--configfile', 'NuGet.Config'];
    const result = await runProcess(toolchain.dotnet, args, { cwd: directory, timeoutMs: 120000 });
    if (result.exitCode !== 0) throw new Error(`Locked SDK reference restore failed: ${result.stdout}${result.stderr}`);
    return [toolchain.dotnet, ...args];
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function qualify(settings) {
  const results = path.resolve(root, process.env.SHARPFORGE_RESULTS_DIR || 'artifacts/results', 'oracles', platform);
  await mkdir(results, { recursive: true });
  await rm(path.join(results, 'expected'), { recursive: true, force: true });
  await writeFile(path.join(results, 'oracle-toolchain.json'), `${JSON.stringify(pin, null, 2)}\n`);
  const report = { schemaVersion: 1, status: 'running', mode: settings.mode, platform, startedUTC: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)], commit: null, dirty: null, toolchain: null, observations: [], unsupported: [], failures: [] };
  await writeFile(path.join(results, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const record = async entry => {
    await writeExpected(entry, path.join(results, 'expected'));
    if (settings.mode === 'update') await writeExpected(entry);
    if (settings.mode === 'verify') {
      try { await compareExpected(entry); } catch (error) { report.failures.push(error.message); }
    }
  };
  try {
    const revision = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root });
    if (revision.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(revision.stdout.trim())) throw new Error('Oracle qualification requires an identifiable Git commit');
    report.commit = revision.stdout.trim();
    const checkout = await runProcess('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root });
    if (checkout.exitCode !== 0) throw new Error('Cannot determine oracle checkout state');
    report.dirty = checkout.stdout.length !== 0;
    const targets = planTargets(settings.oracle);
    report.unsupported = targets.filter(value => !value.supported);
    const supported = targets.filter(value => value.supported).map(value => value.oracleId);
    const toolchain = supported.length ? await resolveToolchain() : null;
    if (toolchain) {
      report.toolchain = { ...toolchain.actual, environment: toolchain.environment };
      report.restoreCommand = await checkLockedRestore(toolchain);
    }
    if (supported.includes('roslyn')) {
      for (const fixture of await loadFixtures()) {
        try {
          const compiled = await compileFixture(fixture, toolchain);
          checkFixtureContract(fixture, compiled.result);
          await record(envelope('roslyn', fixture, compiled.result));
          report.observations.push({ fixtureId: fixture.id, oracleId: 'roslyn', inputHash: fixture.inputHash, timingsMs: compiled.timings, command: compiled.command });
          if (fixture.execute && settings.oracle !== 'roslyn') {
            const execution = await runFixture(compiled.assembly, fixture, toolchain);
            checkFixtureContract(fixture, compiled.result, execution.result);
            await record(envelope('coreclr', fixture, execution.result));
            report.observations.push({ fixtureId: fixture.id, oracleId: 'coreclr', inputHash: fixture.inputHash, timingsMs: execution.timings, command: execution.command });
          }
        } catch (error) { report.failures.push(`${fixture.id}: ${error.message}`); }
      }
      if (settings.benchmark && settings.oracle !== 'roslyn') {
        try { report.benchmark = await benchmark(toolchain); }
        catch (error) { report.failures.push(`coreclr benchmark: ${error.message}`); }
      }
    }
    if (supported.includes('winui')) {
      try {
        const winui = await runWinUI(toolchain);
        if (winui.supported) {
          const fixture = await winuiInput();
          await record(envelope('winui', fixture, winui.result));
          report.observations.push({ oracleId: 'winui', fixtureId: fixture.id, inputHash: fixture.inputHash, commands: winui.commands, measurements: winui.measurements });
        } else report.unsupported.push({ oracleId: 'winui', ...winui });
      } catch (error) { report.failures.push(`winui: ${error.message}`); }
    }
    if (settings.mode !== 'capture' && report.observations.length) report.store = await verifyStore();
  } catch (error) { if(error.actualToolchain)report.toolchain=error.actualToolchain;report.failures.push(error.message); }
  report.status = report.failures.length ? 'failed' : !report.observations.length ? 'unsupported' : settings.mode === 'capture' ? 'captured-not-baseline-qualified' : 'passed';
  report.finishedUTC = new Date().toISOString();
  await writeFile(path.join(results, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, observations: report.observations.length, unsupported: report.unsupported, failures: report.failures, report: path.relative(root, path.join(results, 'report.json')) }, null, 2));
  return report;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const report = await qualify(parseArguments(args));
    if (report.failures.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
