import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { localReferenceFixture, localReferenceCases } from './input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit native capture JSON path');
const fixture = localReferenceFixture();
const bytes = fixture.bytes();
const tokens = Object.values(fixture.tokens).filter(token => token >>> 24 === 1);
const template = await readFile(new URL('./Program.cs', import.meta.url), 'utf8');
const sourceBytes = Buffer.from(template.replace('ASSEMBLY_BASE64', Buffer.from(bytes).toString('base64'))
  .replace('TYPE_TOKENS', tokens.join(', ')));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment,
  templateSHA256: sha256(template), sourceSHA256: sha256(sourceBytes), fixtureSHA256: sha256(bytes),
  inputSHA256: sha256(await readFile(new URL('./input.js', import.meta.url))), compilation: compiled.result,
  assembly: Buffer.from(bytes).toString('base64') };
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
const execution = await executeAssembly(compiled.assembly, toolchain);
capture.execution = execution.result;
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(execution.result.exitCode, 0);
assert.equal(execution.result.signal, null);
const adapter = createMetadataVerificationTypeSystem(new AssemblyInspector(bytes));
const observations = JSON.parse(execution.result.stdout).types;
assert.equal(observations.length, tokens.length);
for (const [name, definition] of Object.entries(localReferenceCases)) {
  const token = fixture.tokens[name];
  const native = observations.find(value => value.token === token);
  assert.equal(native.success, true, name);
  assert.equal(native.local, true, name);
  assert.equal(native.definition, fixture.tokens[definition], name);
  assert.equal(adapter.resolveType(token).value.token, native.definition, name);
}
console.log(JSON.stringify({ references: tokens.length, resolved: Object.keys(localReferenceCases).length,
  toolchain: toolchain.actual }));
