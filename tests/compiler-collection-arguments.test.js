import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-T88: collection expression arguments, `[with(arguments), elements]` (C# 15 preview). PROVISIONAL: the pinned
// Roslyn does not implement the feature, so nothing here is a Roslyn fixture. Every expectation follows the pinned
// proposal revision csharplang/proposals/csharp-15.0/collection-expression-arguments.md (commit 412dc302,
// packages/syntax/src/preview-revisions.js); each test names its section. The expected outputs are derived from the
// proposal: the arguments become the argument list of the constructor call, and they are evaluated before the elements.

const preview = { langVersion: 'preview' };
// The string-typed pipeline adds its profile codes next to an error (SF1xxx; SF2143 is its own `with(capacity)` form).
const relevant = d => !/^SF1/.test(d.code) && d.code !== 'SF2143';
// `Bag` keeps the programs outside the string-typed profile, so the semantic pipeline binds and generates them.
const bag =
  'class Bag : IEnumerable { public string Log; public Bag(string name, int factor) { Log = name + "*" + factor; } ' +
  'public Bag(params int[] seeds) { Log = "seeds" + seeds.Length; } public void Add(int value) { Log += " " + value; } ' +
  'public IEnumerator GetEnumerator() { return null; } } ' +
  'class Util { public static int Trace(string text, int value) { Console.WriteLine(text); return value; } } ';
const program = body =>
  `using System; using System.Collections; using System.Collections.Generic; ${bag}class Program { static void Main() { ${body} } }`;
const found = body => {
  const source = program(body);
  return compile(source, preview)
    .diagnostics.filter(relevant)
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};
const outputs = body => {
  const source = program(body),
    result = compile(source, preview);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error' && relevant(d)).map(d => d.code), [], body);
  const il = compileToIL(source, { ...preview, includeDebug: false });
  return [new VirtualMachine(result.image).run().output, new CilVirtualMachine(il.assembly).run().output];
};

test('A02-T88 the arguments are the argument list of the constructor call ("Constructors")', () => {
  // new Bag("bag", factor: 3) followed by Add(4), Add(5).
  assert.deepEqual(outputs('Bag b = [with("bag", factor: 3), 4, 5]; Console.WriteLine(b.Log);'), ['bag*3 4 5\n', 'bag*3 4 5\n']);
  // "If the constructor has a params parameter, the invocation may be in expanded form."
  assert.deepEqual(outputs('Bag b = [with(1, 2, 3), 4]; Console.WriteLine(b.Log);'), ['seeds3 4\n', 'seeds3 4\n']);
  assert.deepEqual(outputs('Bag b = [with(), 4]; Console.WriteLine(b.Log);'), ['seeds0 4\n', 'seeds0 4\n']);
});

test('A02-T88 arguments are evaluated before the elements, each once, left to right ("Construction")', () => {
  const body = 'List<int> l = [with(Util.Trace("capacity", 8)), Util.Trace("first", 1), Util.Trace("second", 2)]; Console.WriteLine(l.Count);';
  assert.deepEqual(outputs(body), ['capacity\nfirst\nsecond\n2\n', 'capacity\nfirst\nsecond\n2\n']);
});

test('A02-T88 a with element makes a type without a parameterless constructor usable ("Conversions")', () => {
  // Without the element the type needs a constructor that can be invoked with no arguments: CS9214, as before.
  const types = 'class Named : IEnumerable { public Named(string name) { } public void Add(int value) { } public IEnumerator GetEnumerator() { return null; } } ';
  const source = body => program(body).replace('class Program', types + 'class Program');
  const codes = body => compile(source(body), preview).diagnostics.filter(d => d.severity === 'error' && relevant(d)).map(d => d.code);
  assert.deepEqual(codes('Named n = [1, 2];'), ['CS9214']);
  assert.deepEqual(codes('Named n = [with("x"), 1, 2];'), []);
});

test('A02-T88 overload resolution failures are the binding errors of the constructor call', () => {
  assert.deepEqual(found('Bag b = [with("a", "b"), 4];'), ['CS1503:"b"']);
});

test('A02-T88 the with element must be first; dynamic arguments are an error ("Construction")', () => {
  assert.deepEqual(found('List<int> l = [1, with(3)];'), ['SF2203:with(3)']);
  assert.deepEqual(found('dynamic d = 3; List<int> l = [with(d), 1];'), ['SF2203:d']);
  const message = compile(program('List<int> l = [1, with(3)];'), preview).diagnostics.find(d => d.code === 'SF2203').message;
  assert.match(message, /collection-expression-arguments\.md revision 1/);
});

test('A02-T88 interface targets ("Interface target type")', () => {
  // IEnumerable<E>, IReadOnlyCollection<E>, IReadOnlyList<E>: the only candidate signature is ().
  assert.deepEqual(found('IEnumerable<int> e = [with(3), 9];'), ['SF2203:with(3)']);
  assert.deepEqual(found('IEnumerable<int> e = [with(), 9];').filter(row => !row.startsWith('SF2200')), []);
  // ICollection<E>, IList<E>: the signatures of List<E>() and List<E>(int).
  assert.deepEqual(found('IList<int> l = [with(4), 7];').filter(row => !row.startsWith('SF2200')), []);
  assert.deepEqual(found('IList<int> l = [with(new int[] { 1 }), 7];'), ['SF2203:with(new int[] { 1 })']);
});

test('A02-T88 other target types: a binding error for the argument list, even if empty ("Other target types")', () => {
  assert.deepEqual(found('int[] a = [with(), 1, 2, 3];'), ['SF2203:with()']);
  assert.deepEqual(found('int[] b = [with(length: 1), 3];'), ['SF2203:with(length: 1)']);
});

test('A02-T88 below preview `with(...)` keeps its earlier meaning: an invocation of a method named with', () => {
  // "Keep previous behavior (no breaking change) when compiling with earlier language version."
  const source = program('Bag b = [with("bag", 3), 4];'),
    codes = compile(source, { langVersion: '14' })
      .diagnostics.filter(d => d.severity === 'error' && relevant(d))
      .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
  assert(codes.includes('CS0103:with'), codes.join(' '));
});
