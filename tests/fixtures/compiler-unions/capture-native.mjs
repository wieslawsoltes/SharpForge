/** Scheduled native comparison of union CIL with an explicit implementation of the pinned proposal's lowering. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileToAssembly } from '@sharpforge/compiler';
import { readReferenceFiles } from '@sharpforge/compiler/node';
import { previewRevisions } from '@sharpforge/syntax';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { unionContracts, unionInputs, unionPreviewOptions } from './contracts.js';

const destination = process.argv[2];
if (!destination) throw new Error('Pass an output JSON path outside the source fixtures.');
const source = await readFile(new URL('./native-source.cs', import.meta.url), 'utf8');
const reference = await readFile(new URL('./native-reference.cs', import.meta.url), 'utf8');
const report = {
  status: 'failed',
  proposal: previewRevisions.Unions,
  comparison: 'SharpForge union CIL versus hand-lowered ordinary C# on the pinned CoreCLR; no Roslyn union syntax oracle',
  sourceSHA256: sha256(source),
  referenceSHA256: sha256(reference),
};
try {
  const toolchain = await resolveToolchain();
  report.toolchain = toolchain.actual;
  report.environment = toolchain.environment;
  const compiled = compileToAssembly(unionInputs(source), { ...unionPreviewOptions, references: readReferenceFiles(toolchain.references) });
  report.sharpforge = { success: compiled.success, diagnostics: compiled.diagnostics };
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  report.sharpforge.assemblySHA256 = sha256(compiled.assembly);
  const referenceBuild = await compileOnce({ source: 'Reference.cs', sourceBytes: reference + unionContracts, langVersion: '14' }, toolchain);
  report.referenceBuild = { ...referenceBuild.result, command: referenceBuild.command };
  assert.equal(referenceBuild.result.exitCode, 0, JSON.stringify(referenceBuild.result));
  const expected = await executeAssembly(referenceBuild.assembly, toolchain);
  const actual = await executeAssembly(Buffer.from(compiled.assembly), toolchain);
  report.referenceExecution = expected;
  report.sharpforgeExecution = actual;
  assert.equal(expected.result.exitCode, 0, expected.result.stderr);
  assert.equal(actual.result.exitCode, 0, actual.result.stderr);
  assert.equal(actual.result.signal, null);
  assert.equal(actual.result.stdout, expected.result.stdout);
  assert.equal(actual.result.stderr, expected.result.stderr);
  report.status = 'passed';
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
}
await writeFile(resolve(destination), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, destination: resolve(destination) }));
