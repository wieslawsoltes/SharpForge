import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { parseILVerify } from '../../../scripts/conformance/verifier/catalog.js';
import { checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { verifyCilAssembly } from '@sharpforge/cil';
import { placementFixture, nativeCases } from './input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit capture JSON path');
const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
if (!tools.supported) throw new Error(tools.reason);
const toolchain = await resolveToolchain();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-no-handler-placement-'));
const capture = { oracle: 'ILVerify', version: tools.verifierPin.version, sdk: pin.sdk, runtime: pin.runtime,
  toolSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256,
  inputSHA256: sha256(await readFile(new URL('./input.js', import.meta.url))),
  environment: toolchain.environment, references: toolchain.actual.referenceAssemblies, observations: [] };
try {
  for (const fixture of nativeCases) {
    const { bytes } = placementFixture(fixture.options);
    const assembly = path.join(temporary, fixture.name + '.dll');
    await writeFile(assembly, bytes);
    const args = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime', '--statistics'];
    for (const reference of toolchain.references) args.push('--reference', reference);
    const raw = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000 });
    const verify = { ...raw, stdout: raw.stdout.replaceAll(temporary, '<temporary>'),
      stderr: raw.stderr.replaceAll(temporary, '<temporary>') };
    const observation = { name: fixture.name, assemblySHA256: sha256(bytes), expected: fixture.accepted, verify };
    capture.observations.push(observation);
    await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
    // The pinned verifier reports this non-fatal check, then dereferences the absent HandlerIndex.
    // This exact tool failure is unavailable evidence, never a successful native rejection.
    const missingHandlerIndex = fixture.name === 'endfinally' && verify.exitCode === 1 && !verify.signal &&
      verify.stderr.includes('System.InvalidOperationException: Nullable object must have a value.') &&
      verify.stderr.includes('at Internal.IL.ILImporter.ImportEndFinally()');
    observation.oracle = missingHandlerIndex
      ? { status: 'unavailable', reason: 'ILVerify 10.0.5 ImportEndFinally missing HandlerIndex', accepted: null, errors: [] }
      : parseILVerify(verify);
    await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
    if (!missingHandlerIndex) {
      assert.equal(observation.oracle.accepted, fixture.accepted, `${fixture.name}: ${verify.stdout}\n${verify.stderr}`);
      if (!fixture.accepted) assert.ok(observation.oracle.errors.includes(fixture.nativeError), fixture.name);
    }
    const admission = verifyCilAssembly(bytes);
    observation.admission = { success: admission.success, issues: admission.issues };
    await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
    assert.equal(admission.success, fixture.accepted, fixture.name);
    if (!fixture.accepted) assert.ok(admission.issues.some(issue =>
      issue.code === 'IL_EH_FLOW' && issue.diagnostic === fixture.diagnostic), fixture.name);
  }
  console.log(JSON.stringify(capture.observations.map(value => ({ name: value.name, accepted: value.oracle.accepted }))));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
