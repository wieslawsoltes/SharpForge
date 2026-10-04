import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, oracleRoot, pin, platform, sha256, requireTarget, resolveToolchain } from '../toolchain.js';
import { runProcess } from '../process.js';
import { assertDeterministic } from '../roslyn-compile.js';

const directory = fileURLToPath(new URL('./', import.meta.url));
const runtimeFiles = ['Oracle.WinUI.csproj', 'app.manifest', 'packages.lock.json'];
export async function loadInput(sourceRoot = directory) {
  const canonicalRoot = await realpath(sourceRoot), fixturesRoot = path.join(sourceRoot, 'fixtures');
  const canonicalFixtures = await realpath(fixturesRoot);
  if (path.dirname(canonicalFixtures) !== canonicalRoot) throw new Error('WinUI fixture directory escapes harness');
  const read = async (file, parent) => {
    if (path.dirname(await realpath(file)) !== parent) throw new Error('WinUI source escapes harness');
    const bytes = await readFile(file);
    if (bytes.length > 256 * 1024) throw new Error('WinUI source exceeds byte bound');
    return bytes;
  };
  const catalog = JSON.parse(await read(path.join(fixturesRoot, 'index.json'), canonicalFixtures));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.fixtures) || catalog.fixtures.length !== 20) throw new Error('WinUI catalog requires exactly 20 fixtures');
  const fixtures = [], ids = new Set(), materials = [];
  for (const fixture of catalog.fixtures) {
    if (!fixture || !/^[a-z][a-z0-9-]{0,79}$/.test(fixture.id ?? '') || ids.has(fixture.id) || fixture.file !== fixture.id + '.xaml' ||
        !['loaded', 'load-error'].includes(fixture.expected) || typeof fixture.description !== 'string' || !fixture.description.trim() ||
        ![fixture.viewport?.width, fixture.viewport?.height].every(value => Number.isFinite(value) && value >= 1 && value <= 2048)) throw new Error('Invalid WinUI fixture contract');
    ids.add(fixture.id);
    const bytes = await read(path.join(fixturesRoot, fixture.file), canonicalFixtures);
    materials.push({ name: 'fixtures/' + fixture.file, sha256: sha256(bytes) });
    fixtures.push({ ...fixture, xaml: bytes.toString('utf8') });
  }
  const sources = {};
  for (const name of ['Program.cs', 'Snapshot.cs']) {
    sources[name] = await read(path.join(sourceRoot, name), canonicalRoot);
    materials.push({ name, sha256: sha256(sources[name]) });
  }
  for (const name of runtimeFiles) materials.push({ name: 'native/' + name, sha256: sha256(await readFile(path.join(oracleRoot, 'WinUI', name))) });
  for (const name of ['global.json', 'NuGet.Config']) materials.push({ name: 'native/' + name, sha256: sha256(await readFile(path.join(oracleRoot, name))) });
  materials.push({ name: 'fixtures/index.json', sha256: sha256(JSON.stringify(catalog)) });
  materials.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return { fixtures, sources, materials, inputHash: sha256(JSON.stringify({ materials, pin, culture: 'en-US', theme: 'Light' })) };
}

export function validateDump(dump, input) {
  if (!dump || dump.schemaVersion !== 1 || dump.inputHash !== input.inputHash || dump.runtime !== pin.runtime ||
      dump.culture !== 'en-US' || dump.theme !== 'Light' || typeof dump.winuiAssemblyVersion !== 'string' ||
      !Array.isArray(dump.observations) || dump.observations.length !== input.fixtures.length) throw new Error('Invalid WinUI measurement identity or count');
  for (const [index, observed] of dump.observations.entries()) {
    const fixture = input.fixtures[index];
    if (observed?.id !== fixture.id || observed.status !== fixture.expected) throw new Error('WinUI fixture identity/outcome mismatch: ' + fixture.id);
    if (observed.status === 'load-error') {
      if (typeof observed.exception !== 'string' || !observed.exception || !Number.isInteger(observed.hresult)) throw new Error('Missing native XAML failure details');
    } else if (observed.viewport?.width !== fixture.viewport.width || observed.viewport?.height !== fixture.viewport.height ||
        !Number.isFinite(observed.rasterizationScale) || observed.rasterizationScale <= 0 ||
        observed.layout?.path !== '0' || typeof observed.layout?.type !== 'string' ||
        !observed.layout.properties || !Array.isArray(observed.layout.children) || !Array.isArray(observed.automation)) {
      throw new Error('Missing native layout/property/automation observation: ' + fixture.id);
    }
  }
  return dump;
}

export async function captureWinUI({ sourceRoot = directory, target = platform, resolve = resolveToolchain, execute = runProcess,
  windowsBuild = Number(os.release().split('.')[2]), temporaryRoot = os.tmpdir() } = {}) {
  const input = await loadInput(sourceRoot), support = requireTarget('winui', target);
  const report = { schemaVersion: 1, status: 'running', target, inputHash: input.inputHash, materials: input.materials,
    declaredFixtures: input.fixtures.length, pinnedToolchain: pin, toolchain: null, commands: [], binaries: [], attempts: [], unsupported: [], failures: [] };
  if (!support.supported) { report.status = 'unsupported'; report.unsupported.push(support); return report; }
  let temporary;
  try {
    if (!Number.isInteger(windowsBuild) || windowsBuild < pin.images.windows.minimumBuild) throw new Error('WinUI requires the pinned minimum Windows build');
    const toolchain = await resolve();
    report.toolchain = { ...toolchain.actual, environment: toolchain.environment };
    temporary = await mkdtemp(path.join(temporaryRoot, 'sharpforge-winui-measure-'));
    const projectRoot = path.join(temporary, 'WinUI');
    await mkdir(projectRoot);
    for (const name of runtimeFiles) await cp(path.join(oracleRoot, 'WinUI', name), path.join(projectRoot, name));
    for (const name of ['global.json', 'NuGet.Config']) await cp(path.join(oracleRoot, name), path.join(temporary, name));
    for (const [name, bytes] of Object.entries(input.sources)) await writeFile(path.join(projectRoot, name), bytes);
    const inputPath = path.join(temporary, 'input.json'), out = path.join(temporary, 'out');
    await writeFile(inputPath, JSON.stringify({ runtime: pin.runtime, inputHash: input.inputHash, fixtures: input.fixtures }));
    const project = path.join(projectRoot, 'Oracle.WinUI.csproj');
    const relative = value => value.replaceAll(temporary, '<temporary>');
    for (const args of [['restore', project, '--locked-mode', '--configfile', path.join(temporary, 'NuGet.Config')],
      ['build', project, '--no-restore', '-c', 'Release', '-o', out]]) {
      const result = await execute(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 600000 });
      report.commands.push({ argv: [toolchain.dotnet, ...args.map(relative)], result });
      if (result.exitCode !== 0 || result.signal) throw new Error('Native WinUI ' + args[0] + ' failed');
    }
    for (const name of (await readdir(out)).filter(name => /\.(dll|exe|json)$/.test(name)).sort()) report.binaries.push({ name, sha256: sha256(await readFile(path.join(out, name))) });
    for (let index = 0; index < 3; index++) {
      const output = path.join(temporary, 'result-' + index + '.json');
      const argv = [path.join(out, 'Oracle.WinUI.exe'), inputPath, output];
      const attempt = { number: index + 1, argv: argv.map(relative), process: null, output: null, result: null };
      report.attempts.push(attempt);
      attempt.process = await execute(argv[0], argv.slice(1), { cwd: out, timeoutMs: 180000, env: { DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '0' } });
      if (attempt.process.exitCode !== 0 || attempt.process.signal || attempt.process.stderr) throw new Error('Native WinUI measurement failed; an interactive Windows desktop is required');
      attempt.output = await readFile(output, 'utf8');
      if (Buffer.byteLength(attempt.output) > 16 * 1024 * 1024) throw new Error('WinUI measurement exceeds output bound');
      attempt.result = validateDump(JSON.parse(attempt.output), input);
      if (index) assertDeterministic(report.attempts[0].result, attempt.result, 'WinUI fixture measurements');
    }
    report.status = 'captured-not-baseline-qualified';
  } catch (error) { report.status = 'failed'; report.failures.push(error.message); if (error.result) report.nativeFailure = error.result; }
  finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  return report;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) throw new Error('Usage: winui-measure/run.js --output NEW_REPORT.json');
  const revision = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root });
  const status = await runProcess('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root });
  if (revision.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim()) || status.exitCode !== 0) throw new Error('Cannot bind WinUI capture to source revision');
  const report = { ...await captureWinUI(), commit: revision.stdout.trim(), dirty: status.stdout.length !== 0,
    capturedAt: new Date().toISOString(), command: [process.execPath, process.argv[1], ...args] };
  const output = path.resolve(args[1]); await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, fixtures: report.declaredFixtures, failures: report.failures, output }));
  if (report.status === 'failed') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
