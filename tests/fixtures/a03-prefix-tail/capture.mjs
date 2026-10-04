import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readPE, validateTailPrefixes } from '@sharpforge/cil';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { parseILVerify } from '../../../scripts/conformance/verifier/catalog.js';
import { checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { cases, prefixTailFixture } from './input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit capture JSON path');
const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
if (!tools.supported) throw new Error(tools.reason);
const toolchain = await resolveToolchain();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-prefix-tail-'));
try {
  const assembly = path.join(temporary, 'PrefixTail.dll');
  const bytes = prefixTailFixture();
  await writeFile(assembly, bytes);
  const pe = readPE(bytes, { inspection: true });
  const observations = [];
  for (let index = 0; index < cases.length; index++) {
    const fixture = cases[index];
    const args = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime',
      '--include', `Fixture\\.Program\\.${fixture.method.name}$`, '--statistics'];
    for (const reference of toolchain.references) args.push('--reference', reference);
    const raw = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000 });
    const oracle = parseILVerify(raw);
    const body = pe.methodBody(0x06000002 + index);
    let diagnostic = null;
    try { validateTailPrefixes(body.code, body.handlers); } catch (error) { diagnostic = error.code ?? error.message; }
    if (diagnostic !== fixture.diagnostic) throw new Error(`Candidate mismatch for ${fixture.method.name}: ${diagnostic}`);
    observations.push({ name: fixture.method.name, code: Buffer.from(body.code).toString('base64'), handlers: body.handlers,
      oracle, diagnostic, raw: { ...raw, stdout: raw.stdout.replaceAll(temporary, '<temporary>'),
        stderr: raw.stderr.replaceAll(temporary, '<temporary>') } });
  }
  await writeFile(path.join(temporary, 'PrefixTail.runtimeconfig.json'), JSON.stringify({ runtimeOptions: {
    tfm: 'net10.0', framework: { name: 'Microsoft.NETCore.App', version: pin.runtime }, rollForward: 'Disable',
  } }));
  const execution = await runProcess(toolchain.dotnet, [assembly], { cwd: temporary });
  const source = await readFile(new URL('./input.js', import.meta.url));
  const result = { oracle: 'ILVerify', version: tools.verifierPin.version, sdk: pin.sdk, runtime: pin.runtime,
    toolSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256,
    sourceSHA256: sha256(source), assemblySHA256: sha256(bytes), environment: toolchain.environment,
    references: toolchain.actual.referenceAssemblies, observations, execution };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  if (execution.exitCode !== 42 || execution.signal !== null) throw new Error('Native tail call did not return 42; capture retained');
  console.log(JSON.stringify({ observations: observations.map(({ name, oracle, diagnostic }) => ({ name, oracle, diagnostic })), execution }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
