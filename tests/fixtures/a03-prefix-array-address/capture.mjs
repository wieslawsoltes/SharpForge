import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readPE, validateTypePrefixes } from '@sharpforge/cil';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { parseILVerify } from '../../../scripts/conformance/verifier/catalog.js';
import { checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { cases, prefixTypeFixture } from './input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path; capture never updates fixtures implicitly');
const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
if (!tools.supported) throw new Error(tools.reason);
const toolchain = await resolveToolchain();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-prefix-array-address-'));
try {
  const assembly = path.join(temporary, 'ArrayAddressPrefixes.dll');
  const bytes = prefixTypeFixture();
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
    const code = pe.methodBody(0x06000001 + index).code;
    let diagnostic = null;
    try { validateTypePrefixes(code, pe.metadata); } catch (error) { diagnostic = error.code ?? error.message; }
    if (diagnostic !== fixture.diagnostic) throw new Error(`Candidate mismatch for ${fixture.method.name}: ${diagnostic}`);
    observations.push({ name: fixture.method.name, code: Buffer.from(code).toString('base64'), oracle, diagnostic,
      raw: { ...raw, stdout: raw.stdout.replaceAll(temporary, '<temporary>'), stderr: raw.stderr.replaceAll(temporary, '<temporary>') } });
  }
  const source = await readFile(fileURLToPath(new URL('./input.js', import.meta.url)));
  const result = { oracle: 'ILVerify', version: tools.verifierPin.version, sdk: pin.sdk, runtime: pin.runtime,
    toolSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256,
    sourceSHA256: sha256(source), assemblySHA256: sha256(bytes), environment: toolchain.environment,
    references: toolchain.actual.referenceAssemblies, observations };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(observations.map(({ name, oracle, diagnostic }) => ({ name, oracle, diagnostic }))));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
