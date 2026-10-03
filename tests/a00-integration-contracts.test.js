import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { BuiltinMap, FORMAT_VERSION, serializeImage, deserializeImage, verifyImage } from '@sharpforge/bytecode';
import { validate } from '../scripts/planning/schema/validate.js';

test('integrated Int64 GC builtin rejects images carrying its former Int32 contract', () => {
  const compiled = compileToIL('var bytes = GC.GetTotalMemory(false); Console.WriteLine(bytes);');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  assert.equal(BuiltinMap.get('GC.GetTotalMemory').result, 'long');
  assert.equal(FORMAT_VERSION, 2);
  const current = JSON.parse(serializeImage(compiled.image));
  const previous = { ...current, formatVersion: 1 };
  assert.throws(() => deserializeImage(JSON.stringify(previous)), /Unsupported SharpForge bytecode version/);
  assert.match(verifyImage(previous).join('\n'), /incompatible/);
  const schema = version => JSON.parse(readFileSync(new URL(`../planning/contracts/schema/bytecode-image.v${version}.schema.json`, import.meta.url)));
  assert.doesNotThrow(() => validate(schema(2), current));
  assert.throws(() => validate(schema(2), previous), { code: 'SCHEMA_VERSION' });
  assert.doesNotThrow(() => validate(schema(1), previous));
  assert.throws(() => validate(schema(1), current), { code: 'SCHEMA_VERSION' });
});


test('compiler checks lossless syntax features for text and reused trees per file', async () => {
  const {parse} = await import('@sharpforge/syntax');
  const {SourceText} = await import('@sharpforge/text');
  const {compile} = await import('@sharpforge/compiler');
  const source = 'class P { static void Main() { Console.WriteLine("""raw"""); } }';
  for (const input of [source, [parse(new SourceText(source, 'Raw.cs'))]]) {
    const rejected = compile(input, {langVersion:'10'});
    assert.equal(rejected.success, false);
    assert.equal(rejected.diagnostics.filter(d=>d.code==='CS8936').length, 1);
    assert.equal(compile(input, {langVersion:'11'}).success, true);
  }
  const parsed = parse(new SourceText(source, 'Raw.cs'));
  assert.equal(compile([parsed], {langVersion:'14',langVersionByUri:{'Raw.cs':'10'}}).success, false);
  assert.equal(compile([parsed], {langVersion:'10',langVersionByUri:{'Raw.cs':'11'}}).success, true);
  const preview = compile('int[] values = [with(capacity: 2), 1, 2];', {langVersion:'14'});
  assert.equal(preview.success, false);
  assert.equal(preview.diagnostics.filter(d=>d.code==='CS8652').length, 1);
});
