// Explicit native reference generation only; offline tests never compile or write fixtures.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';

const output = process.argv[2];
if (!output) throw Error('Pass explicit native capture JSON output');
const sourceBytes = await readFile(new URL('./Program.cs', import.meta.url));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
const report = { toolchain: toolchain.actual, environment: toolchain.environment, sourceSha256: sha256(sourceBytes),
  compilation: compiled.result, command: compiled.command };
const save = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
await save();
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
report.image = compiled.assembly.toString('base64');
report.imageSha256 = sha256(compiled.assembly);
report.execution = (await executeAssembly(compiled.assembly, toolchain)).result;
await save();
assert.equal(report.execution.exitCode, 0, report.execution.stderr);
assert.equal(report.execution.signal, null);
report.native = JSON.parse(report.execution.stdout);
assert.ok(report.native.entries.some(entry => entry.relation === 'overridden-by'));
assert.ok(report.native.entries.some(entry => entry.relation === 'implemented-by'));
await save();
console.log(JSON.stringify({ entries: report.native.entries.length, imageSha256: report.imageSha256, toolchain: toolchain.actual }));
