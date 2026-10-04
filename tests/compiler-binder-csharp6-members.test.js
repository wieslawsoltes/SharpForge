import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T60 and SF-A02-T62: interpolated strings and C# 6 member bodies. The Roslyn-pinned programs are the
// `interpolation-binding` and `member-bodies` fixtures of packages/compiler/test/differential.

const codesIn = (diagnostics, source) =>
  diagnostics.filter(d => d.code.startsWith('CS')).map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const codes = (source, options) =>
  codesIn(
    compile(source, options).diagnostics.filter(d => d.severity === 'error'),
    source,
  );
/** Diagnostics of the semantic analysis alone, without the parser's own. */
const analysed = source => codesIn(analyze([parse(new SourceText(source, 'Program.cs'))], {}).diagnostics, source);
const inMain = body => `class P { static void M() { } static void Main() { int x = 5; ${body} } }`;
function run(source) {
  const result = compile(source);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message),
    [],
  );
  const il = compileToIL(source, { includeDebug: false });
  const output = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(il.assembly).run().output, output);
  return output;
}

test('A02-T60 a hole needs a value: void is CS1503, a lambda without a natural type CS8917', () => {
  assert.deepEqual(codes(inMain('var b = $"{M()}";')), ['CS1503:M()']);
  assert.deepEqual(codes(inMain('var c = $"{y => y}";')), ['CS8917:=>']);
  assert.deepEqual(codes(inMain('var d = $"{Main}{x}";')), []);
});

test('A02-T60 an alignment is an int constant (CS0150), within the range of a format item (CS8094)', () => {
  assert.deepEqual(analysed(inMain('int w = 3; var a = $"{x,w}";')), ['CS0150:w']);
  assert.deepEqual(analysed(inMain('var a = $"{x,1.5}";')), ['CS0266:1.5']);
  assert.deepEqual(analysed(inMain('const int w = 3; var a = $"{x,w}{x,w + 1}"; System.Console.WriteLine(a);')), []);
  // A warning: the program still compiles, so only the analysis shows it.
  assert.deepEqual(analysed(inMain('var h = $"{x, 40000}"; System.Console.WriteLine(h);')), ['CS8094:40000']);
});

test('A02-T60 a string of constant string holes is a constant; anything else is not (CS0133)', () => {
  const constant = 'using System; class P { const string A = "a"; const string B = $"{A}-{"b"}{{}}"; static void Main() { Console.WriteLine(B); } }';
  assert.equal(run(constant), 'a-b{}\n');
  assert.deepEqual(codes(inMain('const string k = $"{x}";')), ['CS0133:$"{x}"']);
  assert.deepEqual(codes(inMain('const string a = "a"; const string k = $"{a,3}";')), ['CS0133:$"{a,3}"']);
});

test('A02-T60 doubled braces are one brace on both back ends', () => {
  const source = 'using System; class C { public int V = 1; } class P { static void Main() { var c = new C(); Console.WriteLine($"{{{c.V}}} {{literal}}"); } }';
  assert.equal(run(source), '{1} {literal}\n');
});

test('A02-T62 auto-property rules: CS8051 without a get accessor, CS8053 in an interface, CS8050 on a computed property', () => {
  const inC = members => `class C { ${members} } class P { static void Main() { } }`;
  assert.deepEqual(codes(inC('public int W { set; } = 4;')), ['CS8051:set']);
  assert.deepEqual(codes(inC('public int W { set; }')), ['CS8051:set']);
  assert.deepEqual(codes(inC('public int X { get { return 1; } } = 5;')), ['CS8050:X']);
  assert.deepEqual(codes('interface I { int P { get; } = 1; } class P { static void Main() { } }'), ['CS8053:P']);
  assert.deepEqual(codes(inC('public int A { get; set; } = 1; public int R { get; } = 2; public static int S { get; } = 3;')), []);
});

test('A02-T62 an accessor list next to an expression body is one CS8057 on the member', () => {
  const source = 'class C { public int Both { get { return 1; } } => 2; } class P { static void Main() { } }';
  assert.deepEqual(codes(source), ['CS8057:public int Both { get { return 1; } } => 2;']);
});

test('A02-T62 initializers run in declaration order before the constructor body; expression bodies run', () => {
  const source =
    'using System; class C { static int T(string s, int v) { Console.WriteLine(s); return v; } ' +
    'public int A { get; set; } = T("A", 1); int f = T("f", 2); public int R { get; } = T("R", 3); ' +
    'public C() { Console.WriteLine("ctor"); A = A + 10; } public int Sum => A + f + R; public int P { get => f; set => f = value; } } ' +
    'class P { static void Main() { var c = new C(); c.P = 5; Console.WriteLine(c.Sum + " " + c.P); } }';
  assert.equal(run(source), 'A\nf\nR\nctor\n19 5\n');
});

test('A02-T62 an accessor or a local function with a block body and an expression body is CS8057', () => {
  const inClass = members => `using System; class P { int n; ${members} static void Main() { } }`;
  assert.deepEqual(codes(inClass('int A { get { return 1; } => 2; }')), ['CS8057:get { return 1; } => 2;']);
  assert.deepEqual(codes(inClass('int B { get => 1; set { n = value; } => n = 0; }')), ['CS8057:set { n = value; } => n = 0;']);
  assert.deepEqual(codes(inClass('int this[int i] { get { return i; } => i + 1; }')), ['CS8057:get { return i; } => i + 1;']);
  assert.deepEqual(codes(inClass('event EventHandler E { add { } => n = 1; remove { } }')), ['CS8057:add { } => n = 1;']);
  assert.deepEqual(codes(inMain('int L() { return 1; } => 2; x = L();')), ['CS8057:int L() { return 1; } => 2;']);
  // One body of either form is fine.
  assert.deepEqual(codes(inClass('int C { get { return 1; } set => n = value; }')), []);
  assert.deepEqual(codes(inMain('int L() => 2; int K() { return 3; } x = L() + K();')), []);
});

test('A02-T60 CS8094 is reported for a program the execution pipeline compiles; the image stands', () => {
  const source = 'using System; class P { static void Main() { int x = 1; Console.WriteLine($"{x,40000}".Length); } }';
  const result = compile(source);
  assert.equal(result.success, true);
  const warnings = result.diagnostics.filter(d => d.severity === 'warning').map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
  assert.deepEqual(warnings, ['CS8094:40000']);
  // In range, or no alignment at all: the analysis is not consulted and nothing is reported.
  const fine = 'using System; class P { static void Main() { int x = 1; Console.WriteLine($"{x,32767}|{x}|{12345}"); } }';
  assert.deepEqual(compile(fine).diagnostics, []);
});
