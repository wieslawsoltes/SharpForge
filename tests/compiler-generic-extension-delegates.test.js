import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T30: a generic extension method converted to a delegate through its receiver (`items.Show` with
// `Show<T>(this Box<T>)`). The type arguments are inferred from the receiver and the delegate's parameter
// types, or written. Reference on real .NET: the Roslyn-pinned program
// `reduced-functional/generic-extension-methods-as-delegates` (tests/compiler-stress-corpus.test.js).

const declarations = `using System;
class Box<T> { public T Value; }
static class Extensions {
  public static string Show<T>(this Box<T> box) => "";
  public static bool Has<T>(this Box<T> box, T value) => true;
  public static TResult Map<T, TResult>(this T value, Func<T, TResult> map) => map(value);
  public static int Twice(this int value) => value * 2;
}`;
const analysisOf = body => analyze([parse(new SourceText(`${declarations}\nclass P { static void M(Box<int> numbers) { ${body} } }`, 'Program.cs'))], {});
const errorsOf = body =>
  analysisOf(body)
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);

test('A02-T30 a generic extension method is a delegate target: type arguments come from the receiver and the delegate', () => {
  assert.deepEqual(errorsOf('Func<string> show = numbers.Show; Func<int, bool> has = numbers.Has; Func<Func<string, int>, int> map = "four".Map;'), []);
  assert.deepEqual(errorsOf('Func<string> show = numbers.Show<int>;'), []);
});

test('A02-T30 what does not fit is still reported: wrong type arguments, a wrong signature, a value type receiver', () => {
  assert.deepEqual(errorsOf('Func<string> show = numbers.Show<string>;'), ['CS0123']);
  assert.deepEqual(errorsOf('Func<string, bool> has = numbers.Has;'), ['CS0123']);
  assert.deepEqual(errorsOf('Func<int> twice = 21.Twice;'), ['CS1113']);
});
