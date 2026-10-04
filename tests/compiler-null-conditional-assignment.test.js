import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnBothBackEnds, errorsOf, codesOf } from './compiler-modern-run.js';

// SF-A02-T85: C# 14 null-conditional assignment. The Roslyn-pinned programs are the `null-conditional-assignment`
// fixtures of packages/compiler/test/differential; these tests cover each form on its own and the stated limits.

const types =
  'class C { public int P; public string S; public int[] A = new int[2]; public C Next; public event Action E; ' +
  'public int Q { get; set; } public void Fire() { if (E != null) E(); } }';
const program = body =>
  `using System; ${types} class Program { static int Side() { Console.WriteLine("side"); return 4; } ` +
  `static C Get(C c) { Console.WriteLine("get"); return c; } static void Main() { C none = null; C some = new C(); ${body} } }`;
const structs = 'struct V { public int X; } class H { public V F; } ';
const run = (body, options) => runOnBothBackEnds(program(body), options);
const errors = (body, options) => errorsOf(program(body), options);

test('A02-T85 simple assignment: the right side is skipped for a null receiver', () => {
  assert.equal(run('none?.P = Side(); some?.P = Side(); Console.WriteLine(some.P);'), 'side\n4\n');
  assert.equal(run('some?.Q = 3; none?.Q = Side(); Console.WriteLine(some.Q);'), '3\n');
});

test('A02-T85 the receiver is evaluated once', () => {
  assert.equal(run('Get(some)?.Q = 2; Get(some)?.Q += 5; Get(none)?.Q += Side(); Console.WriteLine(some.Q);'), 'get\nget\nget\n7\n');
});

test('A02-T85 compound and coalescing assignment', () => {
  assert.equal(run('some?.P += 2; some?.P *= 5; none?.P -= Side(); Console.WriteLine(some.P);'), '10\n');
  assert.equal(run('some?.S ??= "s"; some?.S += "t"; some?.S ??= "unused"; none?.S ??= "x"; Console.WriteLine(some.S);'), 'st\n');
});

test('A02-T85 element targets: a?.b[i] = v and a?[i] = v', () => {
  assert.equal(run('some?.A[1] = 5; none?.A[1] = Side(); some?.A[Side() - 4] -= 3; Console.WriteLine(some.A[1] + some.A[0]);'), 'side\n2\n');
  assert.equal(run('int[] a = { 1 }, b = null; a?[0] = 6; b?[0] = Side(); a?[0] += 1; Console.WriteLine(a[0]);'), '7\n');
});

test('A02-T85 event subscription through ?.', () => {
  assert.equal(run('some?.E += () => Console.WriteLine("ev"); none?.E += () => Console.WriteLine("never"); some.Fire();'), 'ev\n');
});

test('A02-T85 chains: the assignment belongs to the last access', () => {
  assert.equal(run('some.Next = new C(); some?.Next?.P = 8; some.Next?.Next?.P = Side(); Console.WriteLine(some.Next.P);'), '8\n');
});

test('A02-T85 the value of the assignment: a reference, or a value type consumed by ?? and comparisons', () => {
  assert.equal(run('string r = some?.S = "new"; Console.WriteLine(r); Console.WriteLine((none?.S = "x") ?? "null");'), 'new\nnull\n');
  assert.equal(run('Console.WriteLine((none?.P = 6) ?? -1); Console.WriteLine((some?.P = 6) ?? -1);'), '-1\n6\n');
  assert.equal(run('Console.WriteLine((some?.P = 7) == 7); Console.WriteLine((none?.P = 7) == null);'), 'True\nTrue\n');
});

test('A02-T85 is gated: CS9260 below C# 14, accepted from C# 14', () => {
  assert.deepEqual(errors('some?.P = 1; some?.A[0] += 1;', { langVersion: '13' }), ['CS9260:=', 'CS9260:+=']);
  assert.deepEqual(errors('some?.P = 1; some?.A[0] += 1;', { langVersion: '14' }), []);
  assert.deepEqual(errors('some?.P = 1;', { langVersion: 'preview' }), []);
});

test('A02-T85 increment and decrement of a conditional access are not assignments: CS1059', () => {
  assert.deepEqual(errors('some?.P++; --some?.P; some?.A[0]++;'), ['CS1059:some?.P', 'CS1059:some?.P', 'CS1059:some?.A[0]']);
});

test('A02-T85 the target follows the rules of an ordinary assignment', () => {
  const source = 'class D { public int G { get { return 1; } } public void M() { } public int P; } ';
  const body = 'D d = new D(); d?.G = 2; d?.M = 3; d?.P = "s"; d?.M() = 3;';
  assert.deepEqual(errorsOf(`${source} class Program { static void Main() { ${body} } }`), ['CS0200:.G', 'CS1656:.M', 'CS0029:"s"', 'CS0131:.M()']);
});

test('A02-T85 a member of a nullable struct receiver is not a variable: CS0131', () => {
  assert.deepEqual(errorsOf(program('V? v = new V(); v?.X = 1;') + structs), ['CS0131:.X']);
});

test('A02-T85 a type parameter value needs a nullable form only when the value is used: CS8978', () => {
  const source = body => `class Box<T> { public T V; } class Program { static T M<T>(Box<T> box, T value) { ${body} } static void Main() { } }`;
  assert.deepEqual(errorsOf(source('box?.V = value; return value;')), []);
  assert.deepEqual(errorsOf(source('return (box?.V = value);')), ['CS8978:.V = value']);
});

test('A02-T85 limits are reported, not miscompiled: struct types and nullable values the runtime cannot hold', () => {
  // A struct-typed field is outside the runtime profile whatever the assignment form.
  assert(codesOf(program('H h = new H(); h?.F.X = 3;') + structs).includes('SF2200'));
  // A value-typed assignment result stored as `int?` needs Nullable<T>.
  assert(codesOf(program('int? a = some?.P = 5; Console.WriteLine(a);')).includes('SF2200'));
});
