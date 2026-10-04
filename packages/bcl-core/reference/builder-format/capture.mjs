// Explicit native capture; ordinary tests consume the committed report without launching .NET.
import {readFile, writeFile} from 'node:fs/promises';
import {resolveToolchain, sha256} from '../../../../scripts/conformance/oracle/toolchain.js';
import {compileFixture} from '../../../../scripts/conformance/oracle/roslyn-compile.js';
import {runFixture} from '../../../../scripts/conformance/oracle/clr-run.js';

const sourceBytes = await readFile(new URL('Program.cs', import.meta.url));
const fixture = {id: 'bcl-builder-composite-format', source: 'Program.cs', sourceBytes, langVersion: '12.0'};
const toolchain = await resolveToolchain();
const compiled = await compileFixture(fixture, toolchain);
if (compiled.result.exitCode !== 0) throw new Error(JSON.stringify(compiled.result));
const executed = await runFixture(compiled.assembly, fixture, toolchain);
if (executed.result.exitCode !== 0) throw new Error(JSON.stringify(executed.result));
const report = {
  schemaVersion: 1, sourceSHA256: sha256(sourceBytes), toolchain: toolchain.actual,
  environment: toolchain.environment, compileRuns: 2, executionRuns: 2,
  commands: {compile: compiled.command, execute: executed.command},
  compiled: compiled.result, executed: executed.result,
  cases: executed.result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
};
await writeFile(new URL('oracle.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Captured ${report.cases.length} StringBuilder/composite-format cases.`);
