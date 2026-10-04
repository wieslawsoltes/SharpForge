// Explicit capture only. Inputs remain in an external cache; no upstream binary is embedded in the JSON artifact.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { compareReference } from './comparison.mjs';

const [output, r2rPath, mixedPath] = process.argv.slice(2);
if (!output || !r2rPath || !mixedPath || process.argv.length !== 5)
  throw new Error('Usage: capture.mjs <output.json> <pinned-r2r-image> <pinned-mixed-image>');
const fixtureRoot = new URL('./', import.meta.url);
const repository = new URL('../../../', import.meta.url);
const manifestBytes = await readFile(new URL('reference-images.json', fixtureRoot));
const manifest = JSON.parse(manifestBytes);
const sourceBytes = await readFile(new URL('Program.cs', fixtureRoot));
const sourceFiles = [
  'packages/cil/src/inspector-pe.js', 'packages/cil/src/inspector.js', 'packages/cil/src/inspector-method.js',
  'packages/cil/src/browser/summary.js', 'packages/cil/src/pe/reader.js', 'packages/cil/src/pe/optional-header.js',
  'packages/cil/src/pe/debug-directory.js', 'packages/cil/src/pe/method-code.js', 'packages/cil/src/pe/method-header.js',
  'packages/cil/src/pe/method-body.js', 'packages/cil/src/pe/headers.js',
  'tests/fixtures/pe-inspection/comparison.mjs', 'tests/fixtures/pe-inspection/Program.cs',
  'tests/fixtures/pe-inspection/capture.mjs',
];
const sourceSha256 = {};
for (const file of sourceFiles) sourceSha256[file] = sha256(await readFile(new URL(file, repository)));
const report = { schemaVersion: 1, format: 'sharpforge.pe-inspection.native-capture',
  manifestSha256: sha256(manifestBytes), sourceSha256, referencePayloads: 'external-cache-only', observations: [] };
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
await save();
let temporary;
try {
  const toolchain = await resolveToolchain();
  report.toolchain = toolchain.actual;
  report.environment = toolchain.environment;
  const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
  report.compilation = { ...compiled.result, command: compiled.command };
  await save();
  assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
  temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-pe-inspection-'));
  const observer = path.join(temporary, 'Observer.dll');
  await writeFile(observer, compiled.assembly);
  await writeFile(path.join(temporary, 'Observer.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
    tfm: pin.targetFramework, rollForward: 'Disable', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime },
  } }));
  for (const [id, input] of [['r2r', r2rPath], ['mixed', mixedPath]]) {
    const definition = manifest.images.find(image => image.id === id);
    assert.ok(definition, `Missing pinned ${id} manifest`);
    const bytes = await readFile(input);
    assert.equal(bytes.length, definition.bytes, `${id} image length changed`);
    assert.equal(sha256(bytes), definition.sha256, `${id} image hash changed`);
    const observation = { id, imageSha256: definition.sha256, imageBytes: bytes.length,
      inputExecution: { status: 'not-run', reason: id === 'mixed'
        ? 'Windows C++/CLI image is inspected as data; Linux execution is unsupported by this fixture.'
        : 'ReadyToRun image is inspected as data; native code execution and mapping are outside this inspector.' } };
    report.observations.push(observation);
    const args = ['--fx-version', pin.runtime, observer, path.resolve(input)];
    const execution = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000, maxOutputBytes: 8 * 1024 * 1024 });
    observation.execution = { ...execution, stdout: undefined,
      command: [toolchain.dotnet, '--fx-version', pin.runtime, '<observer>/Observer.dll', `<cache>/${definition.fileName}`] };
    await save();
    assert.equal(execution.exitCode, 0, execution.stderr);
    assert.equal(execution.signal, null);
    observation.native = JSON.parse(execution.stdout);
    await save();
    assert.equal(observation.native.imageKind, definition.expectedImageKind);
    observation.comparison = compareReference(bytes, observation.native);
    await save();
    assert.deepEqual(observation.comparison.differences, [], `${id} PEReader/SRM facts differ`);
    assert.ok(observation.comparison.counts.availableCil > 0, `${id} fixture must preserve actual CIL bodies`);
    if (id === 'r2r') {
      assert.equal(observation.native.cli.flags & 1, 0, 'The pinned R2R fixture exercises ILOnly-unset');
      assert.equal(observation.native.managedNativeSignature, 0x00525452);
    } else assert.ok(observation.comparison.counts.nonCil > 0, 'Mixed fixture must contain actual non-CIL method implementations');
  }
  report.status = 'pass';
  await save();
  console.log(JSON.stringify({ output: path.resolve(output),
    observations: report.observations.map(value => ({ id: value.id, ...value.comparison.counts })) }));
} catch (error) {
  report.status = 'failed';
  report.failure = { name: error.name, message: error.message };
  await save();
  throw error;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
