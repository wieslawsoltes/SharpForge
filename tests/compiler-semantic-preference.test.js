import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';

// SF-A02-E05: a program that both binders reject gets the diagnostics of the semantic analysis (pinned against
// Roslyn 5.3.0.0 in packages/compiler/test/differential) when that analysis is complete, also when the program uses
// only constructs of the execution profile.

const codes = (source, options) =>
  compile(source, options)
    .diagnostics.map(d => `${d.code}@${d.start}+${d.length}`)
    .sort();

test('A02-E05 a rejected program inside the profile reports what Roslyn reports', () => {
  // The execution binder reported CS0103 for a local used before its declaration.
  const useBefore = 'class P { static void Main() { int z = y; int y = 1; } }';
  assert.deepEqual(codes(useBefore), ['CS0841@39+1']);
  // ... and CS0029 where an explicit conversion exists.
  assert.deepEqual(codes('int x = 1.5; System.Console.WriteLine(x);'), ['CS0266@8+3']);
});

test('A02-E05 one error does not cascade into errors about the error type', () => {
  const result = compile('class P { static void Main() { var v = Missing.Create(); v.Text = "a"; } }');
  assert.deepEqual(
    result.diagnostics.map(d => d.code),
    ['CS0103'],
  );
  assert.equal(result.success, false);
  assert.equal(result.image, null);
});

test('A02-E05 accessors and operators cannot be called by their metadata name (CS0571)', () => {
  const source =
    'class C { public int X { get; set; } public static C operator +(C a, C b) { return a; } }\n' +
    'class P { static void Main() { var c = new C(); c.set_X(7); int x = c.get_X(); C d = C.op_Addition(c, c); int y = c.get_Y(); } }';
  // Operator declarations are outside the execution profile: its SF1018 stays next to the C# diagnostics.
  const reported = compile(source).diagnostics.filter(d => d.code.startsWith('CS'));
  assert.deepEqual(
    reported.map(d => [d.code, source.slice(d.start, d.start + d.length)]),
    [
      ['CS0571', 'set_X'],
      ['CS0571', 'get_X'],
      ['CS0571', 'op_Addition'],
      ['CS1061', 'get_Y'],
    ],
  );
  assert.match(reported[0].message, /^'C\.X\.set': cannot explicitly call operator or accessor$/);
  assert.match(reported[2].message, /^'C\.operator \+\(C, C\)': cannot explicitly call operator or accessor$/);
});

test('A02-E05 a local of an unknown type gets the type error only', () => {
  const result = compile('class P { static void Main() { Foo f = null; int unused = 1; } }');
  assert.deepEqual(
    result.diagnostics.map(d => d.code),
    ['CS0246', 'CS0219'],
  );
  assert.match(result.diagnostics[1].message, /'unused'/);
});

test('A02-E05 a program the profile compiles is not affected', () => {
  const result = compile('class P { static void Main() { int x = 1; System.Console.WriteLine(x); } }');
  assert.equal(result.success, true);
  assert.deepEqual(result.diagnostics, []);
});

test('A02-E05 an incomplete analysis leaves the diagnostics of the execution binder in place', () => {
  // System.Text.Json is outside the closed framework registry: the analysis cannot decide, so nothing is replaced.
  const source = 'using System.Text.Json; class P { static void Main() { int x = "a"; JsonDocument d = null; } }';
  const result = compile(source);
  assert(result.diagnostics.some(d => d.code === 'CS0029'), JSON.stringify(result.diagnostics.map(d => d.code)));
  assert.equal(result.success, false);
});
