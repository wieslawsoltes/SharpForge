import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-T54: what callers of a partial method see, and the declaration rules added on top of the merge of
// tests/compiler-member-partial.test.js. The Roslyn-pinned programs are the `partial-methods` fixtures of
// packages/compiler/test/differential.

const codesOf = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);

const outputs = source => {
  const result = compile(source);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error'),
    [],
  );
  const il = compileToIL(source, { includeDebug: false });
  assert.equal(il.success, true);
  return [new VirtualMachine(result.image).run().output, new CilVirtualMachine(il.assembly).run().output];
};

test('A02-T54 callers use the parameter names and default values of the defining declaration', () => {
  const source =
    'using System; partial class C { ' +
    'partial void M(int a, int b = 5) { Console.WriteLine(a + " " + b); } ' +
    'partial void M(int first, int second = 7); ' +
    'public void Run() { M(1); M(second: 3, first: 2); } } ' +
    'class P { static void Main() { new C().Run(); } }';
  assert.deepEqual(outputs(source), ['1 7\n2 3\n', '1 7\n2 3\n']);
  // The default value on the implementing declaration is never used.
  assert.deepEqual(codesOf(source), ['CS1066:b']);
});

test('A02-T54 the names of the implementing declaration are not argument names', () => {
  const source =
    'partial class C { partial void M(int first); partial void M(int a) { } void Run() { M(a: 1); } static void Main() { } }';
  assert.deepEqual(codesOf(source), ['CS1739:a']);
});

test('A02-T54 a parameter is optional only when the defining declaration says so', () => {
  const source =
    'partial class C { partial void M(int x); partial void M(int x = 2) { } void Run() { M(); } static void Main() { } }';
  assert.deepEqual(codesOf(source), ['CS1066:x', 'CS7036:M']);
});

test('A02-T54 a call to an unimplemented method is removed with its arguments, on both back ends', () => {
  const source =
    'using System; partial class C { partial void Gone(int x); partial void Kept(int x); ' +
    'public void Run() { Gone(Side()); Kept(Side()); } static int Side() { Console.WriteLine("side"); return 1; } } ' +
    'partial class C { partial void Kept(int x) { Console.WriteLine("kept " + x); } } ' +
    'class P { static void Main() { new C().Run(); } }';
  assert.deepEqual(outputs(source), ['side\nkept 1\n', 'side\nkept 1\n']);
});

test('A02-T54 virtual modifiers need an accessibility modifier (CS8798, not CS0621)', () => {
  assert.deepEqual(codesOf('partial class C { virtual partial void V(); static void Main() { } }'), ['CS8798:V']);
  // An extern declaration is an implementing part, here without a defining one.
  assert.deepEqual(codesOf('partial class C { extern partial void E(); static void Main() { } }').sort(), ['CS0759:E', 'CS8798:E']);
});

test('A02-T54 the parts must agree on params, virtual modifiers and ref returns', () => {
  const inC = members => `partial class C { ${members} static void Main() { } }`;
  assert.deepEqual(codesOf(inC('partial void P(params int[] x); partial void P(int[] x) { }')), ['CS0758:P']);
  assert.deepEqual(codesOf(inC('public virtual partial void V(); public partial void V() { }')), ['CS8800:V']);
  assert.deepEqual(codesOf(inC('public partial ref int R(); public partial int R() { return 0; }')), ['CS8818:R']);
});

test('A02-T54 a partial method of an interface is not "abstract" (no CS0750)', () => {
  const source = 'partial interface I { partial void M(); } class P { static void Main() { } }';
  assert.deepEqual(codesOf(source), []);
});

test('A02-T54 two implementing declarations without a definition are also duplicates', () => {
  const alone = 'partial class C { partial void B() { } partial void B() { } static void Main() { } }';
  assert.deepEqual(codesOf(alone).sort(), ['CS0111:B', 'CS0757:B', 'CS0759:B']);
  const withDefinition = 'partial class C { partial void B(); partial void B() { } partial void B() { } static void Main() { } }';
  assert.deepEqual(codesOf(withDefinition), ['CS0757:B']);
});

test('A02-T54 CS0762 is reported on the whole method group expression', () => {
  const source = 'partial class C { partial void N(int x); void Use() { System.Action<int> b = this.N; b(1); } static void Main() { } }';
  assert.deepEqual(codesOf(source), ['CS0762:this.N']);
});

test('A02-T54 text + delegate is string concatenation, not delegate combination', () => {
  const source = 'using System; class P { static void Main() { Action a = Main; string s = "x"; string t = s + a; Console.WriteLine(t.Length > 1); } }';
  assert.deepEqual(codesOf(source), []);
});

test('SF-A02-T54 differences between the parts: CS0761, CS8142, CS0764, CS8663; ref and in are different methods', () => {
  const inType = (members, kind = 'class') => `partial ${kind} C { ${members} } class Program { static void Main() { } }`;
  assert.deepEqual(codesOf(inType('partial void A<T>(T x) where T : class; partial void A<T>(T x) where T : struct { }')), ['CS0761:A']);
  // The order of the constraints and the names of the type parameters do not matter.
  const reordered = 'partial void B<T>(T x) where T : System.IDisposable, new(); partial void B<U>(U x) where U : System.IDisposable, new() { }';
  assert.deepEqual(codesOf(inType(reordered)), []);
  assert.deepEqual(codesOf(inType('partial void E((int a, int b) t); partial void E((int x, int y) t) { }')), ['CS8142:E']);
  assert.deepEqual(codesOf(inType('partial void K(ref int x); partial void K(in int x) { }')), ['CS0759:K']);
  assert.deepEqual(codesOf(inType('readonly partial void R(); partial void R() { }', 'struct')), ['CS8663:R']);
  const unsafeParts = inType('unsafe partial void H(); partial void H() { }');
  assert.deepEqual(codesOf(unsafeParts, { allowUnsafe: true }), ['CS0764:H']);
  assert.deepEqual(codesOf(unsafeParts), ['CS0227:H']);
});

test('SF-A02-T54 CS8826 is a level 6 warning: names and nullable annotations that differ between the parts', () => {
  const source = (members, prefix = '') => `${prefix}partial class C { ${members} } class Program { static void Main() { } }`;
  const names = source('partial void D(int first); partial void D(int one) { } partial void J<T>(T x); partial void J<U>(U x) { }');
  assert.deepEqual(codesOf(names), [], 'not reported at the default warning level');
  assert.deepEqual(codesOf(names, { warningLevel: 9999 }), ['CS8826:D', 'CS8826:J']);
  const parts = 'partial void A(string s); partial void A(string? s) { } partial void N(string[] xs); partial void N(string?[] xs) { }';
  assert.deepEqual(codesOf(source(parts, '#nullable enable\n'), { warningLevel: 9999 }), ['CS8826:A', 'CS8826:N']);
  const identical = source('partial void Same(int x, string s); partial void Same(int x, string s) { }');
  assert.deepEqual(codesOf(identical, { warningLevel: 9999 }), []);
});

test('SF-A02-T54 a call to an unimplemented partial method cannot be in an expression tree (CS0765)', () => {
  const source =
    'using System; using System.Linq.Expressions; partial class C { partial void None(); ' +
    'void Use() { Expression<Action> e = () => None(); } } class Program { static void Main() { } }';
  assert.deepEqual(codesOf(source), ['CS0765:None()']);
});

test('SF-A02-T54 the parts may differ in dynamic against object: one method, CS8826 at warning level 6', () => {
  const source = 'partial class C { partial void F(object o); partial void F(dynamic o) { } } class Program { static void Main() { } }';
  assert.deepEqual(codesOf(source), []);
  assert.deepEqual(codesOf(source, { warningLevel: 9999 }), ['CS8826:F']);
});
