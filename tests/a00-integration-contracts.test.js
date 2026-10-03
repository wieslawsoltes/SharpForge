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
