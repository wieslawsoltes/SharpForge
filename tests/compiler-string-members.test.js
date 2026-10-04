import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { isParamsParameter } from '../packages/compiler/src/symbols/registry-params.js';

// The programs that run are the `string-members` fixtures of packages/compiler/test/differential (pinned with Roslyn).

function analysed(statements) {
  const source = `using System; class P { static void Main() { ${statements} } }`;
  const result = analyze([parse(new SourceText(source, 'Program.cs'))], {});
  return { complete: !result.incomplete, codes: result.diagnostics.filter(d => d.severity === 'error').map(d => d.code) };
}

test('the parameter arrays of string.Format, Concat and Join are known to the binder', () => {
  const contract = (name, parameters) => ({ owner: 'System.String', name, parameters });
  assert.equal(isParamsParameter(contract('Format', ['string', 'object[]']), 1), true);
  assert.equal(isParamsParameter(contract('Format', ['string', 'object[]']), 0), false);
  assert.equal(isParamsParameter(contract('Concat', ['string[]']), 0), true);
  assert.equal(isParamsParameter(contract('Join', ['string', 'string[]']), 1), true);
  // Not a parameter array in the BCL (the generic Join<T> takes a sequence), and not an array at all.
  assert.equal(isParamsParameter(contract('Join', ['string', 'int[]']), 1), false);
  assert.equal(isParamsParameter(contract('Concat', ['string', 'string']), 1), false);
});

test('a call in expanded form binds: more arguments than any fixed overload has', () => {
  assert.deepEqual(analysed('var s = string.Format("{0}{1}{2}{3}{4}", 1, 2, 3, "x", null);'), { complete: true, codes: [] });
  assert.deepEqual(analysed('var s = string.Concat("a", "b", "c", "d");'), { complete: true, codes: [] });
  assert.deepEqual(analysed('var s = string.Join(",", "a", "b", "c");'), { complete: true, codes: [] });
});

test('the fixed overloads still win, although the registry lists string.Concat(string, string) twice', () => {
  assert.deepEqual(analysed('var s = string.Concat("a", "b");'), { complete: true, codes: [] });
  assert.deepEqual(analysed('var s = string.Format("{0}", 1) + string.Join(",", new[] { "a" });'), { complete: true, codes: [] });
});

test('string members behind ?. are bound', () => {
  const body = 'string s = null; var a = s?.Trim(); var b = s?.ToUpper().Substring(1); var c = s?.Split(" ").Length ?? 0;';
  assert.deepEqual(analysed(body), { complete: true, codes: [] });
});
