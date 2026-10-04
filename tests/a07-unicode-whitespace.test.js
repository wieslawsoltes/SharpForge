import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {unicodeReference, withUnicodePlatform, callString} from './fixtures/a07/unicode.js';

test('A07 Unicode reference records the pinned runtime and current capture source', () => {
  assert.equal(unicodeReference.runtime, '10.0.5');
  assert.equal(unicodeReference.extractor.sdk, '10.0.201');
  assert.equal(unicodeReference.codeUnitCount, 65536);
  assert.equal(unicodeReference.codePointCount, 0x110000);
  const source = readFileSync(new URL('../packages/bcl-core/reference/unicode-capture/Program.cs', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), unicodeReference.extractor.sourceSHA256);
  assert.match(unicodeReference.extractor.assemblySHA256, /^[a-f0-9]{64}$/);
});

for (const engine of ['source', 'cil']) {
  test(`A07 ${engine}: all 65536 UTF-16 units match .NET whitespace and Trim`, () => {
    const whitespace = new Set(unicodeReference.whitespace);
    withUnicodePlatform(engine, platform => {
      for (let unit = 0; unit < unicodeReference.codeUnitCount; unit++) {
        const value = String.fromCharCode(unit);
        const expected = whitespace.has(unit);
        const label = 'U+' + unit.toString(16).padStart(4, '0');
        assert.equal(Boolean(callString(platform, 'IsNullOrWhiteSpace', [value], ['string'])), expected, label);
        assert.equal(callString(platform, 'Trim', [value]), expected ? '' : value, label);
      }
    });
  });

  test(`A07 ${engine}: directional trim preserves BOM and removes NEXT LINE`, () => {
    withUnicodePlatform(engine, platform => {
      assert.equal(Boolean(callString(platform, 'IsNullOrWhiteSpace', [null], ['string'])), true);
      assert.equal(Boolean(callString(platform, 'IsNullOrWhiteSpace', [''], ['string'])), true);
      const text = '\u0085\u00a0value\u2007\u0085';
      assert.equal(callString(platform, 'TrimStart', [text]), 'value\u2007\u0085');
      assert.equal(callString(platform, 'TrimEnd', [text]), '\u0085\u00a0value');
      assert.equal(callString(platform, 'Trim', ['\ufeffvalue\ufeff']), '\ufeffvalue\ufeff');
      assert.equal(callString(platform, 'Trim', ['\u0085\ufeff\u0085']), '\ufeff');
    });
  });

  test(`A07 ${engine}: null string Split matches the exact pinned overload`, () => {
    withUnicodePlatform(engine, platform => {
      for (const fixture of unicodeReference.splits) {
        const count = fixture.count === 2147483647 ? 1000000 : fixture.count;
        assert.deepEqual(callString(platform, 'Split', [fixture.input, null, count], ['string', 'int']), fixture.output);
        if (fixture.count === 2147483647) {
          assert.deepEqual(callString(platform, 'Split', [fixture.input, null], ['string']), fixture.output);
        }
      }
      assert.throws(() => callString(platform, 'Split', ['value', null, -1], ['string', 'int']), {
        name: 'ArgumentOutOfRangeException'
      });
    });
  });
}
