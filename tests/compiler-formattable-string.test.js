import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// Interpolated strings converted to FormattableString and IFormattable (SF-A02-T60). The Roslyn-pinned program is
// `interpolation-binding/cs0029-formattable-string-and-iformattable-targets` of packages/compiler/test/differential.

const program = body => `using System; class P { static void Take(FormattableString f) { } static void Main() { int x = 1; ${body} } }`;

function analysed(body) {
  const source = program(body),
    result = analyze([parse(new SourceText(source, 'Program.cs'))], {});
  assert.equal(result.incomplete, false, 'the analysis is complete');
  return result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}

test('an interpolated string converts to FormattableString and IFormattable, whose members are known', () => {
  assert.deepEqual(analysed('FormattableString f = $"a{x}"; IFormattable g = $"b{x}"; Take($"c{x}");'), []);
  assert.deepEqual(analysed('FormattableString f = $"a{x}"; string s = f.Format + f.ArgumentCount + f.GetArgument(0) + f.GetArguments().Length;'), []);
  assert.deepEqual(analysed('IFormattable g = $"b{x}"; string s = g.ToString(null, null) + FormattableString.Invariant($"c{x}");'), []);
});

test('only the interpolated string expression itself converts: not a string, a concatenation or a variable', () => {
  assert.deepEqual(analysed('FormattableString f = "plain";'), ['CS0029:"plain"']);
  assert.deepEqual(analysed('FormattableString f = $"a" + $"b";'), ['CS0029:$"a" + $"b"']);
  assert.deepEqual(analysed('var v = $"v{x}"; FormattableString f = v;'), ['CS0029:v']);
});

test('the conversion is SF2200 naming the missing factory: no string is passed off as a FormattableString', () => {
  const result = compile(program('FormattableString f = $"a{x}";'));
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS')), []);
  const unsupported = result.diagnostics.find(d => d.code === 'SF2200');
  assert.match(unsupported.message, /FormattableString/);
});
