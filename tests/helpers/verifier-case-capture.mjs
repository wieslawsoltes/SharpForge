import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pin, resolveToolchain, sha256 } from '../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../scripts/conformance/oracle/process.js';
import { parseILVerify } from '../../scripts/conformance/verifier/catalog.js';
import { checkTools } from '../../scripts/conformance/verifier/tools.js';

/** Capture authored one-method assemblies serially, preserving raw output before parsing or asserting it. */
export async function captureVerifierCases({ output, input, cases, createFixture, describe }) {
  if (!output) throw new Error('Pass an explicit capture JSON path');
  const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
  if (!tools.supported) throw new Error(tools.reason);
  const toolchain = await resolveToolchain();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-verifier-cases-'));
  const capture = { oracle: 'ILVerify', version: tools.verifierPin.version, sdk: pin.sdk, runtime: pin.runtime,
    toolSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256,
    inputSHA256: sha256(await readFile(input)), environment: toolchain.environment,
    references: toolchain.actual.referenceAssemblies, observations: [] };
  const save = () => writeFile(output, JSON.stringify(capture, null, 2) + '\n');
  try {
    for (const fixture of cases) {
      const bytes = createFixture(fixture);
      const assembly = path.join(temporary, fixture.name + '.dll');
      await writeFile(assembly, bytes);
      const args = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime', '--statistics'];
      for (const reference of toolchain.references) args.push('--reference', reference);
      const raw = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000 });
      const verify = { ...raw, stdout: raw.stdout.replaceAll(temporary, '<temporary>'),
        stderr: raw.stderr.replaceAll(temporary, '<temporary>') };
      const observation = { name: fixture.name, assemblySHA256: sha256(bytes), ...describe(fixture), verify };
      capture.observations.push(observation);
      await save();
      observation.oracle = parseILVerify(verify);
      await save();
    }
    for (const observation of capture.observations)
      assert.equal(observation.oracle.accepted, observation.expectedNative, JSON.stringify(observation));
    return capture;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
