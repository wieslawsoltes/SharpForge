import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit native capture JSON path');
const sourceBytes = await readFile(new URL('./Program.cs', import.meta.url));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
const executed = await executeAssembly(compiled.assembly, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment, sourceSHA256: sha256(sourceBytes),
  compilation: compiled.result, execution: executed.result, assembly: compiled.assembly.toString('base64') };
// Preserve native observations even if the adapter comparison fails.
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(executed.result.exitCode, 0);
assert.equal(executed.result.signal, null);
const native = JSON.parse(executed.result.stdout);
const adapter = createMetadataVerificationTypeSystem(new AssemblyInspector(compiled.assembly));
let known = 0;
let unknown = 0;
for (const pair of native.pairs) {
  const result = adapter.isAssignable(adapter.resolveType(pair.source).value, adapter.resolveType(pair.target).value);
  if (result.status === 'unknown') unknown++;
  else { assert.equal(result.value, pair.assignable, JSON.stringify(pair)); known++; }
}
assert(known > 0 && unknown > 0);
console.log(JSON.stringify({ pairs: native.pairs.length, known, unknown, toolchain: toolchain.actual }));
