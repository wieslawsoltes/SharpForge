import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { compile } from '@sharpforge/compiler';
import { emitAssemblyDetailed, readPE } from '@sharpforge/cil';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { parseILVerify } from '../../../scripts/conformance/verifier/catalog.js';
import { checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { cases } from './input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit output JSON path');
const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
if (!tools.supported) throw new Error(tools.reason);
const toolchain = await resolveToolchain();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-emitter-regions-'));
const observations = [];
try {
  for (const fixture of cases) {
    const compiled = compile(fixture.source);
    if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
    const emitted = emitAssemblyDetailed(compiled.image, { name: fixture.name });
    const pe = readPE(emitted.bytes);
    const assembly = path.join(temporary, fixture.name + '.dll');
    await writeFile(assembly, emitted.bytes);
    await writeFile(path.join(temporary, fixture.name + '.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
      tfm: 'net10.0', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime }, rollForward: 'Disable',
    } }));
    const name = pe.metadata.string(pe.metadata.row(pe.entryPoint)[3]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const args = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime',
      '--include', `\\.${name}$`, '--statistics'];
    for (const reference of toolchain.references) args.push('--reference', reference);
    const verify = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000 });
    const oracle = parseILVerify(verify);
    const execution = await runProcess(toolchain.dotnet, ['--fx-version', pin.runtime, assembly], { cwd: temporary, timeoutMs: 30000 });
    const normalize = raw => ({ ...raw, stdout: raw.stdout.replaceAll(temporary, '<temporary>'),
      stderr: raw.stderr.replaceAll(temporary, '<temporary>') });
    observations.push({ name: fixture.name, assemblySHA256: sha256(emitted.bytes),
      sourceSHA256: sha256(fixture.source), oracle, verify: normalize(verify), execution: normalize(execution), expected: fixture.expected });
  }
  const result = { oracle: 'ILVerify + CoreCLR', version: tools.verifierPin.version, sdk: pin.sdk, runtime: pin.runtime,
    toolSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256,
    fixtureSHA256: sha256(await readFile(fileURLToPath(new URL('./input.js', import.meta.url)))),
    environment: toolchain.environment, references: toolchain.actual.referenceAssemblies, observations };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  for (const value of observations) {
    if (!value.oracle.accepted || value.execution.exitCode !== 0 || value.execution.signal || value.execution.stdout !== value.expected)
      throw new Error(`Native mismatch for ${value.name}; raw evidence retained at ${output}`);
  }
  console.log(JSON.stringify(observations.map(value => ({ name: value.name, accepted: true, output: value.execution.stdout }))));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
