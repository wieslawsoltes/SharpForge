import { readFile, writeFile, mkdir, mkdtemp, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { pin, root, sha256, resolveToolchain, platform } from '../oracle/toolchain.js';
import { runProcess } from '../oracle/process.js';
import { assertDeterministic } from '../oracle/roslyn-compile.js';
import { loadCorpus, directory, parseILVerify, validateCapture } from './catalog.js';
import { checkTools } from './tools.js';

export function methodPattern(method) {
  const name = method.replace('::', '.');
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
}

async function captureCase(fixture, context) {
  const { tools, toolchain, temporary, output, signal } = context;
  const assembly = path.join(temporary, `${fixture.id}.dll`);
  const args = ['/dll', `/output:${assembly}`, path.join(directory, fixture.source)];
  const assembled = await runProcess(tools.ilasm, args, { cwd: temporary, timeoutMs: 30000, signal });
  await writeFile(path.join(output, 'raw', `${fixture.id}.ilasm.json`), `${JSON.stringify(assembled, null, 2)}\n`);
  if (assembled.exitCode !== 0 || assembled.signal) throw new Error(`ILAsm failed for ${fixture.id}`);
  const verifyArgs = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime',
    '--include', methodPattern(fixture.method), '--statistics'];
  for (const reference of toolchain.references) verifyArgs.push('--reference', reference);
  const observations = [];
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await runProcess(toolchain.dotnet, verifyArgs, { cwd: temporary, timeoutMs: 30000, signal });
    await writeFile(path.join(output, 'raw', `${fixture.id}.ilverify-${repeat}.json`), `${JSON.stringify(result, null, 2)}\n`);
    observations.push(parseILVerify(result));
  }
  assertDeterministic(observations[0], observations[1], `ILVerify ${fixture.id}`);
  const bytes = await readFile(assembly);
  await cp(assembly, path.join(output, 'assemblies', `${fixture.id}.dll`));
  const normalize = value => value.replaceAll(temporary, '<temporary>');
  return { id: fixture.id, inputHash: fixture.inputHash, assemblySHA256: sha256(bytes), oracle: observations[0],
    commands: [[tools.ilasm, ...args].map(normalize), [toolchain.dotnet, ...verifyArgs].map(normalize)] };
}

export async function captureVerifier(options = {}) {
  const output = path.resolve(options.output ?? path.join(root, 'artifacts/results/verifier'));
  const tools = await checkTools({
    ilasm: options.ilasm ?? process.env.SHARPFORGE_ILASM,
    ilverify: options.ilverify ?? process.env.SHARPFORGE_ILVERIFY,
    ilasmPins: options.ilasmPins ?? process.env.SHARPFORGE_ILASM_PINS,
  });
  if (!tools.supported) return { status: 'unsupported', ...tools };
  const toolchain = await resolveToolchain();
  const catalog = await loadCorpus();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'sharpforge-verifier-'));
  await mkdir(path.join(output, 'raw'), { recursive: true });
  await mkdir(path.join(output, 'assemblies'), { recursive: true });
  try {
    const cases = [];
    const failures = [];
    for (const fixture of catalog.cases) {
      try {
        cases.push(await captureCase(fixture, { tools, toolchain, temporary, output, signal: options.signal }));
      } catch (error) {
        if (options.signal?.aborted) throw error;
        failures.push({ id: fixture.id, message: error.message });
      }
    }
    const capture = { schemaVersion: 1, oracle: 'ilverify', version: tools.verifierPin.version,
      inventoryHash: catalog.inventoryHash, sanityChecks: false,
      target: platform, sdk: pin.sdk, runtime: pin.runtime, references: toolchain.actual.referenceAssemblies,
      toolSHA256: tools.verifierPin.files.find(file => file.path === tools.verifierPin.entry).sha256,
      ilasmSHA256: tools.assemblerPin.sha256, environment: toolchain.environment, cases };
    await writeFile(path.join(output, 'oracle.json'), `${JSON.stringify(capture, null, 2)}\n`);
    await writeFile(path.join(output, 'capture-failures.json'), `${JSON.stringify(failures, null, 2)}\n`);
    if (failures.length) throw new Error(`${failures.length} native fixture captures failed; see capture-failures.json`);
    validateCapture(capture, catalog, tools.verifierPin);
    return { status: 'captured', output, cases: cases.length };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await captureVerifier({ output: process.argv[2] })));
}
