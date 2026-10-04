// Explicit source-pinned capture. Inputs remain external; this script never executes an input image.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean, git, sha, writeJson } from '../../../scripts/conformance/perf/core.js';
import { pin, resolveToolchain } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { compareReference } from '../pe-inspection/comparison.mjs';
import { boundsCase, caseIds } from './input.mjs';
import { compareAuthored } from './contracts.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [output, r2r, mixed] = process.argv.slice(2).map(value => resolve(value));
assert.equal(process.argv.length, 5, 'Usage: capture.mjs <fresh-directory> <pinned-r2r-image> <pinned-mixed-image>');
assert.ok(!existsSync(output), 'Preserve prior capture; use a fresh external directory');
assert.ok(!output.startsWith(resolve(root) + '/'), 'Capture must remain outside the checkout');
const head = clean(root);
mkdirSync(output);
const report = { schemaVersion: 1, status: 'running', sourceCommit: head, startedAt: new Date().toISOString(),
  commands: [], sourceSha256: {}, aliases: {}, authored: [], references: [],
  rawProvenance: 'All build/observer workload commands; existing resolveToolchain version probes retain identities only.',
  inputExecution: 'not-run', nativeAcceptancePolicy: 'Observed independently; eager overlap admission is a product policy.' };
const save = () => writeJson(resolve(output, 'native.json'), report);
const sourcePaths = git(root, 'ls-files', '--', 'packages/cil/src', 'packages/bytecode/src', 'packages/framework/src',
  'packages/bcl-core/src', 'packages/bcl-collections/src', 'packages/cil/package.json', 'packages/bytecode/package.json',
  'packages/framework/package.json', 'packages/bcl-core/package.json', 'packages/bcl-collections/package.json',
  'tests/fixtures/pe-bounds', 'tests/fixtures/pe-inspection/Program.cs', 'tests/fixtures/pe-inspection/comparison.mjs',
  'tests/fixtures/pe-inspection/reference-images.json', 'tests/fixtures/decompiler-cfg/native.json',
  'scripts/conformance/oracle', 'scripts/conformance/perf/core.js', 'planning/qualification/oracle-toolchain.json').split('\n');
for (const path of sourcePaths) report.sourceSha256[path] = sha(readFileSync(resolve(root, path)));
for (const name of ['cil', 'bytecode', 'framework', 'bcl-core', 'bcl-collections']) {
  const entry = createRequire(resolve(root, 'package.json')).resolve('@sharpforge/' + name);
  assert.equal(entry, resolve(root, 'packages', name, 'src/index.js'));
  report.aliases[name] = entry;
}
save();

async function execute(label, argv) {
  const record = { label, argv, cwd: output, startedAt: new Date().toISOString() };
  report.commands.push(record);
  save();
  try {
    record.result = await runProcess(argv[0], argv.slice(1), { cwd: output, timeoutMs: 60000, maxOutputBytes: 8 * 1024 * 1024 });
  } catch (error) {
    record.result = error.result ?? { exitCode: null, signal: null, error: error.message };
    throw error;
  } finally {
    record.finishedAt = new Date().toISOString();
    for (const stream of ['stdout', 'stderr']) {
      const bytes = record.result?.[stream] ?? '';
      writeFileSync(resolve(output, `${label}.${stream}.log`), bytes, { flag: 'wx' });
      record[stream + 'Sha256'] = sha(bytes);
    }
    save();
  }
  assert.equal(record.result.exitCode, 0, `${label}: ${record.result.stderr}`);
  assert.equal(record.result.signal, null, label);
  return record.result.stdout;
}

async function build(toolchain, label, source) {
  const assembly = resolve(output, label + '.dll');
  const args = [toolchain.dotnet, toolchain.csc, '/nologo', '/noconfig', '/nostdlib+', '/deterministic+',
    '/target:exe', '/langversion:12.0', '/optimize+', '/debug-', '/nullable:enable',
    '/out:' + assembly, ...toolchain.references.map(path => '/reference:' + path), resolve(root, source)];
  await execute('build-' + label, args);
  writeJson(resolve(output, label + '.runtimeconfig.json'), { runtimeOptions: {
    tfm: pin.targetFramework, rollForward: 'Disable', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime },
  } });
  return assembly;
}

try {
  const toolchain = await resolveToolchain();
  report.toolchain = toolchain.actual;
  report.environment = toolchain.environment;
  const authoredObserver = await build(toolchain, 'BoundsObserver', 'tests/fixtures/pe-bounds/Program.cs');
  const inputs = [];
  const bytesById = new Map();
  for (const platform of ['anycpu', 'x64']) for (const name of caseIds) {
    const id = platform + ':' + name;
    const fixture = boundsCase(name, platform);
    const path = resolve(output, platform + '-' + name + '.dll');
    writeFileSync(path, fixture.bytes, { flag: 'wx' });
    inputs.push({ id, path });
    bytesById.set(id, fixture.bytes);
  }
  const manifestPath = resolve(output, 'authored-inputs.json');
  writeJson(manifestPath, inputs);
  const observed = JSON.parse(await execute('observe-authored', [toolchain.dotnet, '--fx-version', pin.runtime,
    authoredObserver, manifestPath]));
  assert.deepEqual(observed.results.map(row => row.id), inputs.map(row => row.id));
  report.authoredObserver = { runtime: observed.runtime, metadataAssemblyVersion: observed.metadataAssemblyVersion };
  for (const row of observed.results) {
    const bytes = bytesById.get(row.id);
    assert.equal(row.observation.imageSha256, sha(bytes));
    assert.equal(row.observation.imageBytes, bytes.length);
    report.authored.push(compareAuthored(bytes, row.id, row.observation));
  }
  save();
  const realObserver = await build(toolchain, 'PEObserver', 'tests/fixtures/pe-inspection/Program.cs');
  const cfg = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/decompiler-cfg/native.json')));
  const il = resolve(output, 'ordinary-il.dll');
  const ilBytes = Buffer.from(cfg.image, 'base64');
  assert.equal(sha(ilBytes), cfg.imageSha256);
  writeFileSync(il, ilBytes, { flag: 'wx' });
  const pinned = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/pe-inspection/reference-images.json')));
  for (const [id, input] of [['il', il], ['r2r', r2r], ['mixed', mixed]]) {
    const bytes = readFileSync(input);
    const definition = pinned.images.find(value => value.id === id);
    if (definition) {
      assert.equal(bytes.length, definition.bytes);
      assert.equal(sha(bytes), definition.sha256);
    }
    const native = JSON.parse(await execute('observe-' + id, [toolchain.dotnet, '--fx-version', pin.runtime, realObserver, input]));
    const comparison = compareReference(bytes, native);
    report.references.push({ id, imageSha256: sha(bytes), imageBytes: bytes.length, native, comparison });
    save();
    assert.deepEqual(comparison.differences, [], id + ': native PE facts');
  }
  assert.equal(clean(root), head);
  for (const [path, expected] of Object.entries(report.sourceSha256))
    assert.equal(sha(readFileSync(resolve(root, path))), expected, 'Unchanged source: ' + path);
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ output, status: report.status, error: report.error }));
}
