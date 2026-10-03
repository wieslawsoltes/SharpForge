import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';

// SF-A02-T86: C# 14 first-class span conversions - binding rules and diagnostics. The Roslyn-pinned programs are the
// `first-class-spans` fixtures of packages/compiler/test/differential (Roslyn 5.3.0-2.26153.122); these tests look
// at what the fixtures cannot show without running: which overload is chosen and what type inference fixes.
// Span<T> does not run on the execution profile yet, so a valid program is reported as not executable (SF2200).

const analysed = (source, langVersion = '14') => {
  const file = parse(new SourceText(source, 'Program.cs'), undefined, { languageVersion: langVersion });
  return analyze([file], { langVersion });
};
const errors = (source, langVersion) =>
  analysed(source, langVersion)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
/** The methods called in `Main`, as display strings, in tree order. */
function callsInMain(source, langVersion) {
  const result = analysed(source, langVersion),
    main = result.assembly.types.find(type => type.name === 'Program').getMembers('Main')[0],
    calls = [];
  walk(result.bound.get(main), node => {
    if (node.kind === 'Call' && node.method) calls.push(node.method.toDisplayString());
    return true;
  });
  return calls;
}
const program = (members, body) => `using System; using System.Collections.Generic; ${members} class Program { static void Main() { ${body} } }`;

test('A02-T86 better conversion target: ReadOnlySpan<T> is preferred over Span<T> for an array argument', () => {
  const source = program('static class C { public static void M(Span<int> s) { } public static void M(ReadOnlySpan<int> s) { } }', 'C.M(new int[1]);');
  assert.deepEqual(errors(source), []);
  assert.deepEqual(callsInMain(source), ['C.M(System.ReadOnlySpan<int>)']);
});

test('A02-T86 better conversion from expression: a span conversion is better than another implicit conversion', () => {
  // The proposal's example ("Betterness remarks"): ambiguous without the rule.
  const members = 'static class E { public static void M(this IEnumerable<int> x) { } public static void M(this ReadOnlySpan<int> x) { } }';
  const source = program(members, 'var a = new int[] { 1, 2, 3 }; a.M();');
  assert.deepEqual(errors(source), []);
  assert.deepEqual(callsInMain(source), ['E.M(System.ReadOnlySpan<int>)']);
  // Below C# 14 only the IEnumerable<int> overload applies to the receiver.
  assert.deepEqual(callsInMain(source, '13'), ['E.M(System.Collections.Generic.IEnumerable<int>)']);
});

test('A02-T86 a span conversion is not considered for the receiver of a method group conversion', () => {
  // Pinned as first-class-spans/method-group-receiver-has-no-span-conversion: the IEnumerable<int> overload is the
  // one a delegate can be created from; with only a Span<int> receiver there is no match (CS0123).
  const members =
    'static class E { public static void OnSpan(this Span<int> s, int x) { } public static void Both(this Span<int> s, int x) { } ' +
    'public static void Both(this IEnumerable<int> e, int x) { } }';
  assert.deepEqual(errors(program(members, 'Action<int> both = new int[0].Both;')), []);
  assert.deepEqual(errors(program(members, 'Action<int> onSpan = new int[0].OnSpan;')), ['CS0123:OnSpan']);
  // The same receiver is fine for an invocation.
  assert.deepEqual(errors(program(members, 'new int[0].OnSpan(1);')), []);
});

test('A02-T86 type inference through a span conversion: exact to Span<T>, lower bound to ReadOnlySpan<T>', () => {
  const members =
    'static class E { public static void W<T>(this Span<T> s) { } public static void R<T>(this ReadOnlySpan<T> s) { } ' +
    'public static void Two<T>(ReadOnlySpan<T> a, T b) { } }';
  const source = program(members, 'int[] n = new int[1]; string[] w = new string[1]; n.W(); n.R(); w.R(); E.Two(w, new object());');
  assert.deepEqual(errors(source), []);
  // `Two(string[], object)`: string is a lower bound through ReadOnlySpan<T>, so T is object.
  assert.deepEqual(callsInMain(source), ['E.W<int>(System.Span<int>)', 'E.R<int>(System.ReadOnlySpan<int>)', 'E.R<string>(System.ReadOnlySpan<string>)', 'E.Two<object>(System.ReadOnlySpan<object>, object)']);
  // Below C# 14 there is no span inference: the calls on the array fail, as in Roslyn (pinned at C# 13).
  assert.deepEqual(errors(program(members, 'int[] n = new int[1]; n.W(); n.R();'), '13'), ['CS0411:W', 'CS0411:R']);
});

test('A02-T86 an extension method takes a span receiver through the span conversion', () => {
  const members = 'static class E { public static int Count(this ReadOnlySpan<int> s) { return s.Length; } }';
  const source = program(members, 'int[] n = new int[1]; Span<int> s = n; int a = n.Count() + s.Count();');
  assert.deepEqual(errors(source), []);
});

test('A02-T86 a valid program with spans is bound and reported as not executable (SF2200), never run wrongly', () => {
  const source = program('', 'int[] n = new int[] { 1, 2 }; ReadOnlySpan<int> s = n; Console.WriteLine(s.Length);');
  const result = compile(source, { langVersion: '14' }),
    codes = result.diagnostics.filter(d => !/^SF1/.test(d.code)).map(d => d.code);
  assert.deepEqual(codes, ['SF2200']);
  assert.equal(result.image ?? null, null);
});
