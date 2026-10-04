import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { parseILVerify } from '../../../scripts/conformance/verifier/catalog.js';
import { checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { fieldFixture } from './input.js';
import { fieldCases } from './cases.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit capture JSON path');
const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
if (!tools.supported) throw new Error(tools.reason);
const toolchain = await resolveToolchain();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-fields-'));
const capture = { oracle: 'ILVerify', version: tools.verifierPin.version, sdk: pin.sdk, runtime: pin.runtime,
  toolSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256,
  inputs: {}, environment: toolchain.environment, references: toolchain.actual.referenceAssemblies, observations: [] };
for (const name of ['input.js', 'cases.js']) capture.inputs[name] = sha256(await readFile(new URL(name, import.meta.url)));
try {
  for (const fixture of fieldCases) {
    const { bytes } = fieldFixture(fixture);
    const assembly = path.join(temporary, fixture.name + '.dll');
    await writeFile(assembly, bytes);
    const args = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime', '--statistics'];
    for (const reference of toolchain.references) args.push('--reference', reference);
    const raw = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000 });
    const verify = { ...raw, stdout: raw.stdout.replaceAll(temporary, '<temporary>'),
      stderr: raw.stderr.replaceAll(temporary, '<temporary>') };
    capture.observations.push({ name: fixture.name, assemblySHA256: sha256(bytes), policyStatus: fixture.status,
      expectedNative: fixture.nativeAccepted ?? fixture.status === 'verified', difference: fixture.difference ?? null,
      verify, oracle: parseILVerify(verify) });
    await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
  }
  // Preserve every first observation before reporting an unexpected oracle result.
  for (const observation of capture.observations)
    assert.equal(observation.oracle.accepted, observation.expectedNative, JSON.stringify(observation));
  console.log(JSON.stringify({ observations: capture.observations.length,
    unsupported: capture.observations.filter(value => value.policyStatus === 'unknown').map(value => value.name),
    differences: capture.observations.filter(value => value.difference).map(value => value.name) }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
