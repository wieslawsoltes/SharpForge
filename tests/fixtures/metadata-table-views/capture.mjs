import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolveToolchain, sha256 } from '../../../scripts/conformance/oracle/toolchain.js';
import { compileOnce } from '../../../scripts/conformance/oracle/roslyn-compile.js';
import { executeAssembly } from '../../../scripts/conformance/oracle/clr-run.js';
import { tablesFixture, pdbTablesFixture } from './fixture.js';
import { compareNativeImage } from './native-compare.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit native capture JSON path');
const cli = tablesFixture();
const pdb = pdbTablesFixture(2);
const images = [
  { label: 'all-cli-tables-pe', bytes: cli.bytes, probes: cli.probes },
  { label: 'all-cli-tables-root', bytes: cli.metadata, probes: cli.probes },
  { label: 'portable-pdb', bytes: pdb.bytes, probes: pdb.probes }
].map(({ bytes, ...rest }) => ({ ...rest, image: Buffer.from(bytes).toString('base64'), sha256: sha256(bytes) }));
const template = await readFile(new URL('./Program.cs', import.meta.url), 'utf8');
const sourceBytes = Buffer.from(template.replace('INPUT_JSON_BASE64', Buffer.from(JSON.stringify(images)).toString('base64')));
const toolchain = await resolveToolchain();
const compiled = await compileOnce({ source: 'Program.cs', sourceBytes, langVersion: '12.0' }, toolchain);
const capture = { toolchain: toolchain.actual, environment: toolchain.environment, templateSHA256: sha256(template),
  sourceSHA256: sha256(sourceBytes), fixtureSHA256: sha256(await readFile(new URL('./fixture.js', import.meta.url))),
  compilation: compiled.result, images };
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(compiled.result.exitCode, 0, JSON.stringify(compiled.result));
const execution = await executeAssembly(compiled.assembly, toolchain);
capture.execution = execution.result;
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
assert.equal(execution.result.exitCode, 0, execution.result.stderr);
assert.equal(execution.result.signal, null);
capture.native = JSON.parse(execution.result.stdout);
await writeFile(output, JSON.stringify(capture, null, 2) + '\n');
const comparisons = images.map(input => compareNativeImage(Buffer.from(input.image, 'base64'),
  capture.native.images.find(image => image.label === input.label)));
console.log(JSON.stringify({ comparisons, toolchain: toolchain.actual }));
