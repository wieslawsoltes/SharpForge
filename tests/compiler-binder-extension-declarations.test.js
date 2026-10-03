import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-E05: extension method declarations and delegates over extension methods. The Roslyn-pinned programs are
// the `extension-declarations` fixtures of packages/compiler/test/differential.

const codes = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const inStatic = members => `static class A { ${members} } class P { static void Main() { } }`;

test('A02-E05 the this parameter: first, not params, not out, ref and in only on value types', () => {
  assert.deepEqual(codes(inStatic('public static int F(int a, this int x) { return x; }')), ['CS1100:this']);
  assert.deepEqual(codes(inStatic('public static void F(this params int[] a) { }')), ['CS1104:params']);
  assert.deepEqual(codes(inStatic('public static void F(out this int s) { s = 1; }')), ['CS8328:this']);
  assert.deepEqual(codes(inStatic('public static void F(ref this string s) { }')), ['CS8337:F']);
  assert.deepEqual(codes(inStatic('public static void F(in this string s) { }')), ['CS8338:F']);
  assert.deepEqual(codes(inStatic('public static void F(ref this int x) { x = 1; } public static int G(in this int x) { return x; }')), []);
  assert.deepEqual(codes(inStatic('public static void F(this dynamic d) { }')), ['CS1103:dynamic']);
});

test('A02-E05 where an extension method may be declared', () => {
  const method = 'public static int E(this int x) { return x; }';
  assert.deepEqual(codes(`class N { ${method} ${method.replace('E', 'F')} } class P { static void Main() { } }`), ['CS1106:N']);
  assert.deepEqual(codes(`static class G<T> { ${method} } class P { static void Main() { } }`), ['CS1106:G']);
  assert.deepEqual(codes(`static class O { public static class I { ${method} } } class P { static void Main() { } }`), ['CS1109:E']);
  assert.deepEqual(codes(inStatic(method)), []);
});

test('A02-E05 a delegate over an extension method: reference receivers only (CS1113), the receiver picks the overload', () => {
  const extensions =
    'using System; static class A { public static int Ok(this int x) { return x; } public static int Len(this string s) { return s.Length; } ' +
    'public static string Tag(this object o) { return "obj"; } public static string Tag(this string s) { return "str"; } } ';
  const main = body => `${extensions}class P { static void Main() { ${body} } }`;
  assert.deepEqual(codes(main('Func<int> f = 7.Ok;')), ['CS1113:7.Ok']);
  assert.deepEqual(codes(main('Func<int> g = "s".Len; Func<string> h = "x".Tag; Func<int, int> open = A.Ok;')), []);
  assert.deepEqual(codes(main('Func<string> wrong = "s".Len;')), ['CS0407:"s".Len']);
});

test('A02-E05 a delegate over an extension method runs: the receiver is bound once, removal and equality use it', () => {
  const source =
    'using System; class C { public int N; } ' +
    'static class A { public static int Len(this string s) { return s.Length; } public static void Bump(this C c) { c.N++; } } ' +
    'class P { static int Use(Func<int> f) { return f(); } static void Main() { Func<int> g = "abc".Len; var c = new C(); ' +
    'Action a = c.Bump; a += c.Bump; a -= c.Bump; a(); Action b = c.Bump; ' +
    'Console.WriteLine(g() + " " + Use("hello".Len) + " " + c.N + " " + (a == b)); } }';
  const result = compile(source);
  assert.equal(result.success, true, result.diagnostics.map(d => d.code + ' ' + d.message).join('; '));
  assert.equal(new VirtualMachine(result.image, { maxInstructions: 1_000_000 }).run().output, '3 5 1 True\n');
});

test('A02-E05 an extension method on an array receiver is found and runs on both back ends', () => {
  const source =
    'using System; static class A { public static int Count(this int[] a) { return a.Length; } } ' +
    'class P { static void Main() { Console.WriteLine(new int[2].Count()); } }';
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const il = compileToIL(source, { includeDebug: false });
  assert.equal(new VirtualMachine(result.image).run().output, '2\n');
  assert.equal(new CilVirtualMachine(il.assembly).run().output, '2\n');
});
