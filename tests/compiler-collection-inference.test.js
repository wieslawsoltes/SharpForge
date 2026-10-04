import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';

// C# 12 collection-expression input/output inference, with C# 13 params collections and element betterness.
// Each analysis uses source-defined methods: no execution-profile overload approximation is involved.
function bind(members, body, langVersion = '14') {
  const source = `using System; using System.Collections.Generic;
class Program {
${members}
static void Main() { ${body} }
}`;
  const file = parse(new SourceText(source, 'Program.cs'), undefined, { languageVersion: langVersion });
  const result = analyze([file], { langVersion });
  const main = result.assembly.types.find(type => type.name === 'Program').getMembers('Main')[0];
  const calls = [];
  walk(result.bound.get(main), node => {
    if (node.kind === 'Call' && node.method?.containingType?.name === 'Program') calls.push(node.method.toDisplayString());
    return true;
  });
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  return { calls, errors: errors.map(diagnostic => `${diagnostic.code}:${source.slice(diagnostic.start, diagnostic.start + diagnostic.length)}`) };
}

test('collection inference: expression elements and spread iteration types infer a normal params collection', () => {
  const result = bind(
    'static void JoinAll<T>(string separator, params IEnumerable<T> values) { }',
    'string[] names = ["carol", "alice"]; JoinAll("~", [.. names, "z"]); JoinAll("/", [.. names]); JoinAll("+", [1, 2L]);',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [
    'Program.JoinAll<string>(string, params System.Collections.Generic.IEnumerable<string>)',
    'Program.JoinAll<string>(string, params System.Collections.Generic.IEnumerable<string>)',
    'Program.JoinAll<long>(string, params System.Collections.Generic.IEnumerable<long>)',
  ]);
});

test('collection inference: nested arrays and generic collection element types contribute recursively', () => {
  const result = bind(
    'static void Arrays<T>(T[] values) { } static void Nested<T>(List<T[]> values) { }',
    'Arrays([1, 2, 3]); int[] values = [4, 5]; Nested([[1, 2], [], [.. values]]);',
    '12',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [
    'Program.Arrays<int>(int[])',
    'Program.Nested<int>(System.Collections.Generic.List<int[]>)',
  ]);
});

test('collection inference: explicit lambda parameters contribute input and lambda results contribute output', () => {
  const result = bind(
    'static void Map<T, R>(IEnumerable<Func<T, R>> maps) { } static void Seed<T, R>(T seed, IEnumerable<Func<T, R>> maps) { }',
    'Map([(int x) => x.ToString()]); Seed(1, [x => x.ToString()]);',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [
    'Program.Map<int, string>(System.Collections.Generic.IEnumerable<System.Func<int, string>>)',
    'Program.Seed<int, string>(int, System.Collections.Generic.IEnumerable<System.Func<int, string>>)',
  ]);
});

test('collection inference: method group output waits for collection delegate input types', () => {
  const result = bind(
    'static string Format(int value) => "value"; static void Seed<T, R>(T seed, List<Func<T, R>> maps) { }',
    'Seed(1, [Format]);',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, ['Program.Seed<int, string>(int, System.Collections.Generic.List<System.Func<int, string>>)']);
});

test('collection inference: empty, typeless, incompatible and unconstrained-target elements do not invent bounds', () => {
  const result = bind(
    'static void Items<T>(IEnumerable<T> values) { } static void Value<T>(T value) { } static void Nested<T>(List<T[]> values) { }',
    'Items([]); Items([null]); Items([1, "text"]); Value([1, 2]); Nested([[], []]);',
  );
  assert.deepEqual(result.errors, ['CS0411:Items', 'CS0411:Items', 'CS0411:Items', 'CS0411:Value', 'CS0411:Nested']);
});

test('collection inference: another argument fixes an empty collection and nested default element', () => {
  const result = bind(
    'static void Items<T>(T seed, IEnumerable<T> values) { } static void Nested<T>(T seed, List<T[]> values) { }',
    'Items(1, []); Items("x", [null, default]); Nested(1, [[], [default]]);',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [
    'Program.Items<int>(int, System.Collections.Generic.IEnumerable<int>)',
    'Program.Items<string>(string, System.Collections.Generic.IEnumerable<string>)',
    'Program.Nested<int>(int, System.Collections.Generic.List<int[]>)',
  ]);
});

test('collection betterness: a ReadOnlySpan wins over an array interface for identical element types', () => {
  const result = bind(
    'static void Describe(ReadOnlySpan<object> values) { } static void Describe(IEnumerable<object> values) { }',
    'string[] values = ["x", "y"]; Describe(values); Describe(["p", "q"]); Describe([]);',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, Array(3).fill('Program.Describe(System.ReadOnlySpan<object>)'));
});

test('collection betterness: C# 13 compares individual element conversions before collection preferences', () => {
  const result = bind(
    'static void Pick(List<int> values) { } static void Pick(List<byte> values) { } ' +
      'static void Span(Span<int> values) { } static void Span(ReadOnlySpan<int> values) { }',
    'Pick([1, 2]); Pick([(byte)1, (byte)2]); Span([1, 2]);',
    '13',
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [
    'Program.Pick(System.Collections.Generic.List<int>)',
    'Program.Pick(System.Collections.Generic.List<byte>)',
    'Program.Span(System.ReadOnlySpan<int>)',
  ]);
});

test('collection betterness: conflicting element preferences and untyped empty collections stay ambiguous', () => {
  const result = bind(
    'static void Pick(List<int> values) { } static void Pick(List<byte> values) { } ' +
      'static void Span(Span<string> values) { } static void Span(ReadOnlySpan<object> values) { }',
    'Pick([1, (byte)2]); Pick([]); Span([]);',
    '13',
  );
  assert.deepEqual(result.errors.map(diagnostic => diagnostic.split(':')[0]), ['CS0121', 'CS0121', 'CS0121']);
});
