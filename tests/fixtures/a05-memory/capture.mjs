// Explicit capture only: ordinary tests replay recorded bytes and never invoke the native compiler.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {resolveToolchain, pin, sha256} from '../../../scripts/conformance/oracle/toolchain.js';
import {runProcess} from '../../../scripts/conformance/oracle/process.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit native capture JSON output path');
const source = await readFile(fileURLToPath(new URL('./Program.cs', import.meta.url)));
const toolchain = await resolveToolchain();
const directory = await mkdtemp(join(tmpdir(), 'sharpforge-a05-memory-'));
const report = {toolchain: toolchain.actual, environment: toolchain.environment, sourceSHA256: sha256(source)};
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
try {
  const input = join(directory, 'Program.cs'), assembly = join(directory, 'Memory.dll');
  await writeFile(input, source);
  const arguments_ = [toolchain.csc, '/nologo', '/noconfig', '/nostdlib+', '/deterministic+', '/optimize+', '/debug-',
    '/langversion:12.0', '/unsafe+', '/target:exe', '/pathmap:' + directory + '=/a05-memory', '/out:' + assembly,
    ...toolchain.references.map(reference => '/reference:' + reference), input];
  const result = await runProcess(toolchain.dotnet, arguments_, {cwd: directory});
  report.compilation = {arguments: arguments_.map(value => value.replaceAll(directory, '<temporary>')), result};
  await save();
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.signal, null);
  const bytes = await readFile(assembly);
  const inspector = new AssemblyInspector(bytes);
  report.image = {sha256: sha256(bytes), bytes: bytes.toString('base64')};
  report.fieldRVA = inspector.metadata.rows[29]?.length ?? 0;
  report.initializers = 0;
  for (const method of inspector.methods.values()) {
    for (const instruction of inspector.getMethod(method.token).instructions) {
      if (instruction.name === 'call' && inspector.resolveToken(instruction.operand).name === 'InitializeArray') report.initializers++;
    }
  }
  assert.ok(report.fieldRVA > 0 && report.initializers > 0, 'Roslyn must emit FieldRVA and InitializeArray');
  await writeFile(join(directory, 'Memory.runtimeconfig.json'), JSON.stringify({runtimeOptions: {
    tfm: pin.targetFramework, rollForward: 'Disable', framework: {name: 'Microsoft.NETCore.App', version: pin.runtime}
  }}));
  report.execution = await runProcess(toolchain.dotnet, [assembly], {cwd: directory});
  await save();
  assert.equal(report.execution.exitCode, 0, report.execution.stderr);
  assert.equal(report.execution.signal, null);
  const vm = new CilVirtualMachine(bytes);
  try {
    const candidate = vm.run();
    report.candidate = {state: candidate.state, output: candidate.output,
      fault: candidate.fault ? {name: candidate.fault.name, message: candidate.fault.message} : null};
    await save();
    assert.equal(candidate.state, 'terminated', candidate.fault?.message);
    assert.equal(candidate.output, report.execution.stdout.replaceAll('\r\n', '\n'));
  } finally { vm.stop(); }
  console.log(JSON.stringify({assemblySHA256: report.image.sha256, fieldRVA: report.fieldRVA,
    initializers: report.initializers, outputLines: report.candidate.output.trim().split('\n').length, toolchain: report.toolchain}));
} finally {
  await rm(directory, {recursive: true, force: true});
}
