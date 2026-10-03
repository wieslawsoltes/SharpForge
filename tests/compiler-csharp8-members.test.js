import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

// SF-A02-E08: null-coalescing assignment, readonly members, interface member kinds, `??` over type parameters.

/** The C# diagnostics of a program as `code text`, where text is the source the diagnostic covers. */
function diagnosticsOf(source, options = {}, severity = 'error') {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === severity && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
// `Marker` is outside the execution profile, so every program here is bound by the semantic binder.
const program = (members, statements = '') => `using System; struct Marker { } class Program { ${members} static void Main() { ${statements} } }`;
const withTypes = types => `using System; ${types} class Program { static void Main() { } }`;

test('SF-A02-E08 ??= assigns only when the target is null and yields the value', () => {
  const lines = linesOf(`using System;
    class Program {
      static int calls;
      static string Make() { calls++; return "made"; }
      string F; string Q { get; set; }
      static void Main() {
        string s = null; s ??= Make(); s ??= Make();
        int[] a = null; (a ??= new int[2])[0] = 7;
        var p = new Program(); p.F ??= "f"; p.Q ??= "q";
        string[] items = new string[1]; items[0] ??= "e"; items[0] ??= "x";
        string t = s ??= "unused";
        Console.WriteLine(s + " " + calls + " " + a[0] + " " + p.F + p.Q + items[0] + " " + t);
      }
    }`);
  assert.deepEqual(lines, ['made 1 7 fqe made']);
});

test('SF-A02-E08 ??= needs a target that can be null and a right operand that converts to it (CS0019)', () => {
  assert.deepEqual(diagnosticsOf(program('', 'int i = 0; i ??= 1;')), ['CS0019 i ??= 1']);
  assert.deepEqual(diagnosticsOf(program('', 'string s = null; s ??= 1;')), ['CS0019 s ??= 1']);
  assert.deepEqual(diagnosticsOf(program('', 'int? n = null; n ??= "s";')), ['CS0019 n ??= "s"']);
  assert.deepEqual(diagnosticsOf(program('static string M() { return null; }', 'M() ??= "x";')), ['CS0131 M()']);
  assert.deepEqual(diagnosticsOf(program('', 'object o = null; o ??= default; string s = null; string r = s ??= null; Console.WriteLine(o + r);')), []);
});

test('SF-A02-E08 ??= is gated below C# 8', () => {
  const source = program('', 'string s = null; s ??= "x";');
  const gates = compile(source, { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.deepEqual(gates.map(d => source.slice(d.start, d.start + d.length)), ['??=']);
});

test('SF-A02-E08 a readonly member cannot assign the fields of this (CS1604) and warns on a mutating call (CS8656)', () => {
  const struct = body => withTypes(`struct S { public int X; public void Mutate() { X++; } ${body} }`);
  assert.deepEqual(diagnosticsOf(struct('public readonly void Set() { X = 1; }')), ['CS1604 X']);
  assert.deepEqual(diagnosticsOf(struct('public readonly int P { get { return X; } set { X = value; } }')), ['CS1604 X']);
  assert.deepEqual(diagnosticsOf(struct('public int Q { readonly get { return X; } set { X = value; } }')), []);
  assert.deepEqual(diagnosticsOf(struct('public readonly void Call() { Mutate(); }'), {}, 'warning'), ['CS8656 Mutate']);
  assert.deepEqual(diagnosticsOf(struct('public readonly int Twice() => X * 2; public readonly int Both() => Twice();'), {}, 'warning'), []);
});

test('SF-A02-E08 where readonly is not allowed on a member (CS0106, CS8657, CS8659, CS8661)', () => {
  const struct = body => withTypes(`struct S { public int X; ${body} }`);
  assert.deepEqual(diagnosticsOf(struct('public static readonly void St() { }')), ['CS8657 St']);
  assert.deepEqual(diagnosticsOf(struct('public readonly int Auto { get; set; }')), ['CS8659 Auto']);
  assert.deepEqual(diagnosticsOf(struct('public int R { readonly get { return X; } readonly set { } }')), ['CS8661 R']);
  // A constructor marked readonly is rejected for the modifier alone: it still assigns the fields.
  assert.deepEqual(diagnosticsOf(struct('public readonly S(int x) { X = x; }')), ['CS0106 S']);
  assert.deepEqual(diagnosticsOf(withTypes('class C { public readonly void M() { } public readonly int P => 1; }')), ['CS0106 M', 'CS0106 P']);
  assert.deepEqual(diagnosticsOf(withTypes('interface I { readonly void M(); }')), ['CS0106 M']);
});

test('SF-A02-E08 readonly members are gated below C# 8', () => {
  const source = withTypes('struct S { public int X; public readonly int Twice() => X * 2; }');
  const gates = compile(source, { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.equal(gates.length, 1);
  assert.match(gates[0].message, /'readonly members'/);
});

test('SF-A02-E08 an interface declares no instance fields or instance constructors (CS0525, CS0526)', () => {
  assert.deepEqual(diagnosticsOf(withTypes('interface I { int Field; }')), ['CS0525 Field']);
  assert.deepEqual(diagnosticsOf(withTypes('interface I { I() { } }')), ['CS0526 I']);
  assert.deepEqual(diagnosticsOf(withTypes('interface I { static int Count; const int K = 3; static I() { Count = K; } int M() { return Count; } }')), []);
  // An unassigned field of an internal interface is reported like one of a class.
  assert.deepEqual(diagnosticsOf(withTypes('interface I { int Field; }'), {}, 'warning'), ['CS0649 Field']);
});

test('SF-A02-E08 ?? over an unconstrained type parameter is a C# 8 form', () => {
  const source = program('static T M<T>(T a, T b) { return a ?? b; } static T O<T>(T a, T b) where T : class { return a ?? b; }');
  const gates = compile(source, { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.deepEqual(gates.map(d => source.slice(d.start, d.start + d.length)), ['a ?? b']);
  assert.match(gates[0].message, /'unconstrained type parameters in null coalescing operator'/);
  assert.deepEqual(compile(source, { langVersion: '8' }).diagnostics.filter(d => d.code === 'CS8370'), []);
  assert.deepEqual(diagnosticsOf(program('static T N<T>(T a, T b) where T : struct { return a ?? b; }')), ['CS0019 a ?? b']);
});
