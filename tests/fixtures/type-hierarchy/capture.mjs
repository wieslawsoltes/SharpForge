// Explicit capture only; ordinary tests never write fixtures or run the native compiler.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain, pin, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';

const output = process.argv[2];
if (!output) throw Error('Pass an explicit capture JSON output');
const root = fileURLToPath(new URL('./', import.meta.url));
const toolchain = await resolveToolchain();
const directory = await mkdtemp(join(tmpdir(), 'sharpforge-hierarchy-native-'));
const report = { toolchain: toolchain.actual, environment: toolchain.environment, sources: {}, compilation: [], images: [] };
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
try {
  for (const name of ['Hierarchy.A', 'Hierarchy.B']) {
    const source = await readFile(join(root, name + '.cs'));
    report.sources[name] = sha256(source);
    await writeFile(join(directory, name + '.cs'), source);
    const args = [toolchain.csc, '/nologo', '/noconfig', '/nostdlib+', '/deterministic+', '/optimize+', '/debug-',
      '/langversion:12.0', '/target:' + (name === 'Hierarchy.A' ? 'library' : 'exe'),
      '/pathmap:' + directory + '=/hierarchy', '/out:' + join(directory, name + '.dll'),
      ...toolchain.references.map(path => '/reference:' + path)];
    if (name === 'Hierarchy.B') args.push('/reference:' + join(directory, 'Hierarchy.A.dll'));
    args.push(join(directory, name + '.cs'));
    const result = await runProcess(toolchain.dotnet, args, { cwd: directory });
    report.compilation.push({ name, command: args.map(arg => arg.replaceAll(directory, '<temporary>')), result });
    await save();
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.signal, null);
    const bytes = await readFile(join(directory, name + '.dll'));
    report.images.push({ name, sha256: sha256(bytes), bytes: bytes.toString('base64') });
  }
  await writeFile(join(directory, 'Hierarchy.B.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
    tfm: pin.targetFramework, rollForward: 'Disable', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime }
  } }));
  report.execution = await runProcess(toolchain.dotnet, [join(directory, 'Hierarchy.B.dll')], { cwd: directory });
  await save();
  assert.equal(report.execution.exitCode, 0, report.execution.stderr);
  assert.equal(report.execution.signal, null);
  report.native = JSON.parse(report.execution.stdout);
  assert.equal(report.native.definitions.length, 8);
  await save();
  console.log(JSON.stringify({ definitions: report.native.definitions.length, images: report.images.map(({ name, sha256 }) => ({ name, sha256 })),
    toolchain: toolchain.actual }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
