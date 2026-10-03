import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, compileToIL } from '@sharpforge/compiler';

const references = ['MiniStandard.dll', 'VersionedLib.1.0.0.0.dll'].map(name => ({
  bytes: new Uint8Array(readFileSync(new URL(`fixtures/metadata/${name}`, import.meta.url))),
}));

test('valid imported symbols cannot turn a failed execution bind into an empty successful image', () => {
  const sources = [
    'using System; class P { static void Main() { Lib.Widget x = new Lib.Widget(); x.Size = 42; Console.WriteLine(x.Size); } }',
    'using System; class P { static void Main() { var x = System.EventArgs.Empty; Console.WriteLine(x); } }',
  ];
  for (const source of sources) {
    for (const pipeline of ['bound', 'legacy']) {
      for (const build of [compile, compileToIL]) {
        const result = build(source, { references, pipeline });
        assert.equal(result.success, false, `${pipeline}: ${source}`);
        assert.equal(result.image, null);
        assert.equal(result.diagnostics.filter(d => d.code === 'SF2200').length, 1, JSON.stringify(result.diagnostics));
        assert.equal(result.diagnostics.some(d => ['CS0246', 'CS0103', 'SF3001'].includes(d.code)), false);
      }
    }
  }
});

test('reference-aware semantic errors retain their diagnostic instead of claiming emission support', () => {
  const source = 'class P { static void Main() { Lib.Widget x = new Lib.Widget(); x.Size = "wrong"; } }';
  const result = compile(source, { references });
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.equal(result.diagnostics.some(d => d.code === 'CS0029'), true);
  assert.equal(result.diagnostics.some(d => d.code === 'SF2200'), false);
});

test('adding metadata references preserves executable programs already supported by the profile', () => {
  const source = 'using System; class P { static void Main() { Console.WriteLine(42); } }';
  for (const pipeline of ['bound', 'legacy']) {
    const result = compile(source, { references, pipeline });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert(result.image.methods.every(method => method.code.length > 0));
  }
});

test('unused invalid metadata is rejected before reporting compilation success', () => {
  for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(0)]) {
    for (const source of ['class P { static void Main() {} }', 'struct S {}']) {
      const result = compile(source, { references: [{ bytes, display: 'Broken.dll' }], outputKind: 'library' });
      assert.equal(result.success, false);
      assert.equal(result.image, null);
      const invalid = result.diagnostics.filter(d => d.code === 'CS0009');
      assert.equal(invalid.length, 1, JSON.stringify(result.diagnostics));
      assert.match(invalid[0].message, /Broken\.dll/);
      assert.equal(result.diagnostics.some(d => d.code === 'SF2201'), false);
    }
  }
});
