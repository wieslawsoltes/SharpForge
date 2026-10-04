import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { AssemblyInspector, createMetadataVerificationTypeSystem } from '@sharpforge/cil';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { nativeCategoryInput } from './native-input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit native capture JSON path');
const sourceBytes = await readFile(new URL('./Program.cs', import.meta.url));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment, sourceSHA256: sha256(sourceBytes),
  compilation: compiled.result, assembly: compiled.assembly?.toString('base64') };
const persist = () => writeFile(output, JSON.stringify(capture, null, 2) + '\n');
await persist();
assert.equal(compiled.result.exitCode, 0);
capture.execution = (await executeAssembly(compiled.assembly, toolchain)).result;
await persist();
assert.equal(capture.execution.exitCode, 0);
assert.equal(capture.execution.signal, null);
const native = JSON.parse(capture.execution.stdout);
const coreBytes = await readFile(native.corePath);
capture.corePE = { sha256: sha256(coreBytes), bytes: coreBytes.length, mvid: native.coreMvid };
const coreInspector = new AssemblyInspector(coreBytes);
const tables = [0, 1, 2, 9, 26, 27, 35, 41, 42];
const projection = { rows: Object.fromEntries(tables.map(table => [table, coreInspector.metadata.rows[table] ?? []])),
  strings: Buffer.from(coreInspector.metadata.streams.get('#Strings')).toString('base64') };
const projectedBytes = Buffer.from(JSON.stringify(projection));
capture.coreMetadataSHA256 = sha256(projectedBytes);
capture.coreMetadata = gzipSync(projectedBytes).toString('base64');
await persist();
const prepared = nativeCategoryInput(capture);
// Compare both the real full inspector and the owned replay against independently captured native categories.
const full = createMetadataVerificationTypeSystem(coreInspector, { coreTypes: prepared.coreAuthority });
const replay = createMetadataVerificationTypeSystem(prepared.coreInspector, { coreTypes: prepared.coreAuthority });
const local = createMetadataVerificationTypeSystem(prepared.inspector, { coreTypes: prepared.coreTypes });
for (const [adapter, observations] of [[full, native.coreTypes], [replay, native.coreTypes], [local, native.localTypes]]) {
  for (const observed of observations) {
    const type = adapter.resolveType(observed.token);
    assert.equal(type.status, 'known', observed.name);
    assert.deepEqual(adapter.typeCategory(type.value), { status: 'known', value: observed.category }, observed.name);
  }
}
capture.comparisons = { core: native.coreTypes.length, local: native.localTypes.length, fullInspectorAndOwnedReplay: true };
await persist();
console.log(JSON.stringify({ ...capture.comparisons, corePE: capture.corePE, toolchain: toolchain.actual }));
