import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { AssemblyInspector, createMetadataVerificationContext } from '@sharpforge/cil';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { memberFixture } from './input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit capture JSON path');
const fixture = memberFixture();
const tokens = [0x04000001, 0x06000001, 0x06000002, 0x06000003, 0x06000004, 0x06000005,
  ...['field', 'intMethod', 'stringMethod', 'instance', 'privateMethod', 'localType'].map(name => fixture.tokens[name])];
const template = await readFile(new URL('./Program.cs', import.meta.url), 'utf8');
const sourceBytes = Buffer.from(template.replace('ASSEMBLY_BASE64', Buffer.from(fixture.bytes).toString('base64'))
  .replace('MEMBER_TOKENS', tokens.join(', ')));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
const execution = await executeAssembly(compiled.assembly, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment,
  templateSHA256: sha256(template), sourceSHA256: sha256(sourceBytes), fixtureSHA256: sha256(fixture.bytes),
  compilation: compiled.result, execution: execution.result };
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(execution.result.exitCode, 0);
assert.equal(execution.result.signal, null);
const context = createMetadataVerificationContext(new AssemblyInspector(fixture.bytes));
for (const member of JSON.parse(execution.result.stdout).members) {
  const resolved = context.resolveMember(member.token);
  assert.equal(resolved.status, 'known');
  for (const key of ['name', 'kind', 'flags']) assert.equal(resolved.value[key], member[key]);
  assert.equal(resolved.value.token, member.definition);
  assert.equal(resolved.value.owner.token, member.owner);
}
console.log(JSON.stringify({ members: tokens.length, toolchain: toolchain.actual }));
