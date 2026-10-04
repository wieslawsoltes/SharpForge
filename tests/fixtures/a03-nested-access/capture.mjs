import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AssemblyInspector, createMetadataVerificationContext } from '@sharpforge/cil';
import { pin, resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { checkTools } from '../../../scripts/conformance/verifier/tools.js';
import { parseILVerify } from '../../../scripts/conformance/verifier/catalog.js';
import { nativeCases, nestedIL } from './native-input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass the explicit native JSON output path');
const tools = await checkTools({ ilasm: process.env.SHARPFORGE_ILASM, ilverify: process.env.SHARPFORGE_ILVERIFY });
if (!tools.supported) throw new Error(tools.reason);
const toolchain = await resolveToolchain();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'a03-nested-access-'));
const observations = [];
const attempts = [];
const normalize = result => ({ ...result, stdout: result.stdout.replaceAll(temporary, '<temporary>'),
  stderr: result.stderr.replaceAll(temporary, '<temporary>') });
try {
  for (const fixture of nativeCases) {
    const source = nestedIL(fixture), assembly = path.join(temporary, fixture.name + '.dll');
    const file = path.join(temporary, fixture.name + '.il');
    await writeFile(file, source);
    const prefix = process.platform === 'win32' ? '/' : '-';
    const assembled = await runProcess(tools.ilasm, [`${prefix}dll`, `${prefix}output:${assembly}`, file],
      { cwd: temporary, timeoutMs: 30000 });
    const attempt = { name: fixture.name, sourceSHA256: sha256(source), assembled: normalize(assembled) };
    attempts.push(attempt);
    await writeFile(output + '.raw.json', JSON.stringify(attempts, null, 2) + '\n');
    if (assembled.exitCode !== 0 || assembled.signal) throw new Error(JSON.stringify(normalize(assembled)));
    const args = ['--fx-version', pin.runtime, tools.ilverify, assembly, '--system-module', 'System.Runtime',
      '--include', '\\.Test$', '--statistics'];
    for (const reference of toolchain.references) args.push('--reference', reference);
    const verify = await runProcess(toolchain.dotnet, args, { cwd: temporary, timeoutMs: 30000 });
    attempt.verify = normalize(verify);
    await writeFile(output + '.raw.json', JSON.stringify(attempts, null, 2) + '\n');
    const oracle = parseILVerify(verify), bytes = await readFile(assembly);
    const inspector = new AssemblyInspector(bytes), metadata = inspector.metadata;
    const context = createMetadataVerificationContext(inspector);
    const type = name => {
      const row = metadata.rows[2].findIndex(value => metadata.string(value[1]) === name);
      if (row < 0) throw new Error('Missing native type ' + name);
      return context.resolveType(0x02000001 + row).value;
    };
    const table = fixture.kind === 'field' ? 4 : 6, nameColumn = fixture.kind === 'field' ? 1 : 3;
    const row = metadata.rows[table].findIndex(value => metadata.string(value[nameColumn]) === 'Target');
    if (row < 0) throw new Error('Missing native target member');
    const member = context.resolveMember(table * 0x1000000 + row + 1).value;
    const result = context.isMemberAccessible(member, type(fixture.accessor),
      fixture.receiver ? { receiverType: type(fixture.receiver) } : {});
    observations.push({ ...fixture, sourceSHA256: sha256(source), assemblySHA256: sha256(bytes),
      assembled: normalize(assembled), verify: normalize(verify), oracle, result });
    await writeFile(output, JSON.stringify({ sdk: pin.sdk, runtime: pin.runtime, version: tools.verifierPin.version,
      environment: toolchain.environment, references: toolchain.actual.referenceAssemblies,
      ilasmSHA256: tools.assemblerPin.sha256,
      verifierSHA256: tools.verifierPin.files.find(value => value.path === tools.verifierPin.entry).sha256, observations }, null, 2) + '\n');
    if (oracle.accepted !== fixture.accepted ||
        (!oracle.accepted && !oracle.errors.includes(fixture.kind === 'field' ? 'FieldAccess' : 'MethodAccess')) ||
        (fixture.query === 'unknown' ? result.status !== 'unknown' : result.status !== 'known' || result.value !== fixture.query))
      throw new Error('Native/nested-access mismatch for ' + fixture.name + '; raw evidence retained');
  }
  console.log(JSON.stringify({ cases: observations.length, known: observations.filter(value => value.result.status === 'known').length }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
