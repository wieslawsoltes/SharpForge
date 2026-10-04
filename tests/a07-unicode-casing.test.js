import test from 'node:test';
import assert from 'node:assert/strict';
import {unicodeReference, withUnicodePlatform, callString} from './fixtures/a07/unicode.js';

for (const engine of ['source', 'cil']) {
  test(`A07 ${engine}: invariant casing matches every scalar and isolated surrogate from .NET`, () => {
    const upper = new Map(unicodeReference.upper);
    const lower = new Map(unicodeReference.lower);
    withUnicodePlatform(engine, platform => {
      // Batches exercise every code point without one managed allocation per individual character.
      for (let start = 0; start < unicodeReference.codePointCount; start += 4096) {
        const input = [], expectedUpper = [], expectedLower = [];
        const end = Math.min(start + 4096, unicodeReference.codePointCount);
        for (let point = start; point < end; point++) {
          input.push(String.fromCodePoint(point));
          expectedUpper.push(String.fromCodePoint(upper.get(point) ?? point));
          expectedLower.push(String.fromCodePoint(lower.get(point) ?? point));
        }
        const text = input.join('');
        const actualUpper = callString(platform, 'ToUpperInvariant', [text]);
        const actualLower = callString(platform, 'ToLowerInvariant', [text]);
        assert.equal(actualUpper.length, text.length, 'upper length at U+' + start.toString(16));
        assert.equal(actualLower.length, text.length, 'lower length at U+' + start.toString(16));
        assert.ok(actualUpper === expectedUpper.join(''), 'upper mapping at U+' + start.toString(16));
        assert.ok(actualLower === expectedLower.join(''), 'lower mapping at U+' + start.toString(16));
      }
    });
  });

  test(`A07 ${engine}: special casing, Greek, astral letters and malformed UTF-16 preserve length`, () => {
    withUnicodePlatform(engine, platform => {
      assert.equal(callString(platform, 'ToUpperInvariant', ['ß']), 'ß');
      assert.equal(callString(platform, 'ToLowerInvariant', ['İ']).length, 1);
      for (const fixture of unicodeReference.examples) {
        const input = String.fromCharCode(...fixture.input);
        for (const [method, expected] of [['ToUpperInvariant', fixture.upper], ['ToLowerInvariant', fixture.lower]]) {
          const actual = callString(platform, method, [input]);
          assert.equal(actual, String.fromCharCode(...expected));
          assert.equal(actual.length, input.length);
        }
      }
    });
  });

  test(`A07 ${engine}: default casing retains the explicitly supported invariant culture profile`, () => {
    withUnicodePlatform(engine, platform => {
      for (const fixture of unicodeReference.examples) {
        const input = String.fromCharCode(...fixture.input);
        assert.equal(callString(platform, 'ToUpper', [input]), String.fromCharCode(...fixture.upper));
        assert.equal(callString(platform, 'ToLower', [input]), String.fromCharCode(...fixture.lower));
      }
    });
  });
}
