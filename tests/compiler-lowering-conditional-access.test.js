import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-T59: null-conditional access. The Roslyn-pinned programs are the `null-conditional` fixtures of
// packages/compiler/test/differential; these tests cover each lowered form on its own, on both back ends, and the
// forms that stay unsupported.

const types =
  'class Node { public Node Next; public string Name; public int V; public int[] Arr; ' +
  'public int Count() { Console.WriteLine("count"); return 2; } public void Do() { Console.WriteLine("do " + Name); } }';
const program = body =>
  `using System; ${types} class P { static Node Make() { Console.WriteLine("make"); return new Node { Name = "n", V = 7 }; } ` +
  `static int Three() { Console.WriteLine("three"); return 3; } static void Main() { Node none = null; Node some = Make(); ${body} } }`;

/** Output of `body` on the bytecode VM and on the CIL VM; they must agree. */
function run(body) {
  const source = program(body),
    result = compile(source);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message),
    [],
  );
  const il = compileToIL(source, { includeDebug: false });
  assert.equal(il.success, true);
  const bytecode = new VirtualMachine(result.image).run().output,
    cil = new CilVirtualMachine(il.assembly).run().output;
  assert.equal(cil, bytecode);
  return bytecode.replace(/^make\n/, '');
}
const codes = body => {
  const source = program(body);
  return compile(source)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};

test('A02-T59 the receiver is evaluated once; a null receiver skips the access and its arguments', () => {
  assert.equal(run('Make()?.Do(); none?.Do(); Console.WriteLine(none?.Name == null);'), 'make\ndo n\nTrue\n');
  assert.equal(run('Console.WriteLine(none?.Name.Substring(Three()) ?? "skipped");'), 'skipped\n');
});

test('A02-T59 chains share the null check: a?.b?.c and a?.b.c', () => {
  assert.equal(run('some?.Next?.Do(); some?.Do(); Console.WriteLine(some?.Next?.Name ?? "none");'), 'do n\nnone\n');
  assert.equal(run('Console.WriteLine(some?.Name.Substring(0)?.Length ?? -1);'), '1\n');
});

test('A02-T59 element access: a?[i], a?.b[i], a?.b?[i]', () => {
  assert.equal(run('int[] a = null; Console.WriteLine(a?[0] ?? -1); a = new[] { 5 }; Console.WriteLine(a?[0] ?? -1);'), '-1\n5\n');
  assert.equal(run('some.Arr = new[] { 4, 5 }; Console.WriteLine((some?.Arr[1] ?? -1) + (none?.Arr?[0] ?? -1));'), '4\n');
});

test('A02-T59 a value-typed result with ??', () => {
  assert.equal(run('Console.WriteLine((none?.V ?? 3) + (some?.V ?? 3));'), '10\n');
  // The right operand runs only when the left one is absent.
  assert.equal(run('Console.WriteLine(some?.V ?? Three()); Console.WriteLine(none?.V ?? Three());'), '7\nthree\n3\n');
});

test('A02-T59 a value-typed result compared with a value: operands run left to right', () => {
  assert.equal(run('Console.WriteLine(some?.V == 7); Console.WriteLine(none?.V == 7); Console.WriteLine(none?.V != 7);'), 'True\nFalse\nTrue\n');
  assert.equal(run('Console.WriteLine(some?.Count() < Three()); Console.WriteLine(none?.Count() < Three());'), 'count\nthree\nTrue\nthree\nFalse\n');
  assert.equal(run('Console.WriteLine(Three() > some?.Count());'), 'three\ncount\nTrue\n');
});

test('A02-T59 a value-typed result compared with null still runs the access', () => {
  assert.equal(run('Console.WriteLine(some?.Count() == null); Console.WriteLine(none?.Count() == null); Console.WriteLine(some?.V != null);'), 'count\nFalse\nTrue\nTrue\n');
});

test('A02-T59 a value-typed result as object, in concatenation and in an interpolation hole', () => {
  assert.equal(run('object o = some?.V; object p = none?.V; Console.WriteLine(o); Console.WriteLine(p == null);'), '7\nTrue\n');
  assert.equal(run('Console.WriteLine("[" + none?.V + "|" + some?.V + "]");'), '[|7]\n');
  assert.equal(run('Console.WriteLine($"{some?.V,4:D3}|{none?.V,3}|{some?.V == 7}");'), ' 007|   |True\n');
});

test('A02-T59 a nullable value that has to be stored is not executable: SF2200, no image', () => {
  const result = compile(program('int? v = some?.V; Console.WriteLine(v);'));
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.match(result.diagnostics.find(d => d.code === 'SF2200').message, /nullable value types/);
  // Lifted arithmetic needs the nullable value as well.
  assert.match(compile(program('Console.WriteLine(some?.V + 1);')).diagnostics.find(d => d.code === 'SF2200').message, /nullable value types/);
});

test('A02-T59 invalid accesses are reported where Roslyn reports them', () => {
  assert.deepEqual(codes('int i = 1; var a = i?.ToString();'), ['CS0023:?']);
  assert.deepEqual(codes('var d = some?.Do;'), ['CS8978:.Do']);
  assert.deepEqual(codes('var g = some?.Missing;'), ['CS1061:.Missing']);
  assert.deepEqual(codes('some?.Name;'), ['CS0201:some?.Name']);
  assert.deepEqual(codes('int v = some?.V;'), ['CS0266:some?.V']);
});
