import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit capture JSON path');
const source = process.argv[3] ?? new URL('../../../tests/fixtures/clr-method-display/Program.cs', import.meta.url);
const sourceBytes = await readFile(source);
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
const execution = await executeAssembly(compiled.assembly, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment,
  sourceSHA256: sha256(sourceBytes), compilation: compiled.result, execution: execution.result,
  image: compiled.assembly.toString('base64') };
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(execution.result.exitCode, 0, JSON.stringify(execution.result));
assert.equal(execution.result.signal, null);
console.log(JSON.stringify({ records: JSON.parse(execution.result.stdout).records.length, toolchain: toolchain.actual }));
