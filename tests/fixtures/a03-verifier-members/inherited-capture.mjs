import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { AssemblyInspector, createMetadataVerificationContext } from '@sharpforge/cil';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { inheritedMemberFixture, inheritedKnownCases } from './inherited-input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit capture JSON path');
const fixture = inheritedMemberFixture();
const names = [...Object.keys(inheritedKnownCases), 'inheritedConstructor', 'missing'];
const tokens = names.map(name => fixture.tokens[name]);
const template = await readFile(new URL('./InheritedProgram.cs', import.meta.url), 'utf8');
const sourceBytes = Buffer.from(template.replace('ASSEMBLY_BASE64', Buffer.from(fixture.bytes).toString('base64'))
  .replace('MEMBER_TOKENS', tokens.join(', ')));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment,
  templateSHA256: sha256(template), sourceSHA256: sha256(sourceBytes), fixtureSHA256: sha256(fixture.bytes),
  inputSHA256: sha256(await readFile(new URL('./inherited-input.js', import.meta.url))), compilation: compiled.result };
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
const execution = await executeAssembly(compiled.assembly, toolchain);
capture.execution = execution.result;
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(execution.result.exitCode, 0);
assert.equal(execution.result.signal, null);
const context = createMetadataVerificationContext(new AssemblyInspector(fixture.bytes));
const observations = JSON.parse(execution.result.stdout).members;
assert.equal(observations.length, names.length);
for (const name of names) {
  const token = fixture.tokens[name];
  const member = observations.find(value => value.token === token);
  const resolved = context.resolveMember(token);
  if (!(name in inheritedKnownCases)) {
    assert.equal(member.success, false, name);
    assert.equal(member.error, 'MissingMethodException', name);
    assert.equal(resolved.status, 'unknown', name);
    continue;
  }
  assert.equal(member.success, true, name);
  assert.equal(resolved.status, 'known', name);
  for (const key of ['name', 'kind', 'flags']) assert.equal(resolved.value[key], member[key]);
  assert.equal(member.definition, inheritedKnownCases[name]);
  assert.equal(resolved.value.token, member.definition);
  assert.equal(resolved.value.owner.token, member.owner);
}
console.log(JSON.stringify({ known: Object.keys(inheritedKnownCases).length, unknown: 2 }));
