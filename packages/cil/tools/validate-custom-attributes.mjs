import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { encodeCustomAttribute, decodeCustomAttribute, readPE } from '@sharpforge/cil';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, 'tests/fixtures/attributes/AttributeOracle');
const scratch = await mkdtemp(join(tmpdir(), 'sharpforge-attributes-'));
const output = join(scratch, 'bin/');
const intermediate = join(scratch, 'obj/');
const revive = (key, value) => value?.$bigint !== undefined ? BigInt(value.$bigint)
  : value?.$number !== undefined ? (value.$number === '-NaN' ? -NaN : Number(value.$number)) : value;
const run = args => execFileSync('dotnet', args, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 });
try {
  run(['build', join(source, 'AttributeOracle.csproj'), '-c', 'Release', '-m:1', '--disable-build-servers',
    `-p:BaseOutputPath=${output}`, `-p:BaseIntermediateOutputPath=${intermediate}`]);
  const dll = join(output, 'Release/net10.0/AttributeOracle.dll');
  const raw = run([dll, source]);
  const data = JSON.parse(raw, revive);
  const bytes = new Uint8Array(await readFile(dll));
  const metadata = readPE(bytes).metadata;
  const options = { metadata, enumUnderlyingType: name => data.enums[name.split(',')[0]] };
  for (const item of data.cases) {
    const expected = Uint8Array.from(Buffer.from(item.blob, 'hex'));
    const named = item.namedArguments.map(argument => ({
      name: argument.name, isField: argument.isField, type: argument.descriptor, value: argument.inputValue,
    }));
    const encoded = encodeCustomAttribute(item.constructor, item.values, named, options);
    assert.deepEqual(encoded, expected, `${item.id} constructor-token encoder bytes`);
    assert.deepEqual(bytes.subarray(item.blobOffset, item.blobOffset + encoded.length), expected, 'native blob offset');
    bytes.set(encoded, item.blobOffset);
    const decoded = decodeCustomAttribute(encoded, item.constructor, options);
    assert.equal(decoded.success, true, JSON.stringify(decoded.diagnostics));
    assert.deepEqual(decoded.constructorArguments, item.decodedConstructorArguments);
    assert.deepEqual(decoded.namedArguments, item.decodedNamedArguments);
  }
  const patched = join(scratch, 'patched.dll');
  await writeFile(patched, bytes);
  const actual = JSON.parse(run([dll, 'reflect', patched]), revive);
  const expected = Object.fromEntries(data.cases.map(item => [item.id, [item.actual]]));
  assert.deepEqual(actual, expected, 'GetCustomAttributes values from JS-written blobs');
  bytes[data.cases[0].blobOffset] = 2;
  const corrupt = join(scratch, 'corrupt.dll');
  await writeFile(corrupt, bytes);
  assert.throws(() => run([dll, 'reflect', corrupt]), /CustomAttributeFormat|custom attribute|format/i);
  if (process.argv.includes('--capture-fixtures')) {
    await writeFile(join(root, 'tests/fixtures/attributes/roslyn.json'), raw);
  } else {
    const pinned = JSON.parse(await readFile(join(root, 'tests/fixtures/attributes/roslyn.json'), 'utf8'), revive);
    assert.deepEqual(data, pinned, 'reference fixture matches the committed inputs');
  }
  console.log(JSON.stringify({ runtime: data.runtime, cases: data.cases.length,
    comparison: 'Roslyn bytes, constructor-token encoding/decoding and native GetCustomAttributes; corrupt-prolog negative passed' }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
