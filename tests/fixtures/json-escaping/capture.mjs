// Explicit capture only: unit tests consume the committed snapshot and never start native processes.
import {readFile, writeFile} from 'node:fs/promises';
import {resolveToolchain, sha256} from '../../../scripts/conformance/oracle/toolchain.js';
import {compileOnce} from '../../../scripts/conformance/oracle/roslyn-compile.js';
import {executeAssembly} from '../../../scripts/conformance/oracle/clr-run.js';

const sourceBytes = await readFile(new URL('Program.cs', import.meta.url));
const fixture = {id: 'json-default-escaping', source: 'Program.cs', sourceBytes, langVersion: '12.0'};
const toolchain = await resolveToolchain();
const compiled = await compileOnce(fixture, toolchain);
if (compiled.result.exitCode !== 0) throw new Error(JSON.stringify(compiled.result));
const executed = await executeAssembly(compiled.assembly, toolchain);
if (executed.result.exitCode !== 0) throw new Error(JSON.stringify(executed.result));
const report = {
  schemaVersion: 1, sourceSHA256: sha256(sourceBytes), toolchain: toolchain.actual,
  environment: toolchain.environment, compileRuns: 1, executionRuns: 1,
  commands: {compile: compiled.command, execute: executed.command},
  compiled: compiled.result, executed: {...executed.result, stdout: undefined},
  cases: executed.result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
};
await writeFile(new URL('oracle.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Captured ${report.cases.length} default JSON escaping cases.`);
