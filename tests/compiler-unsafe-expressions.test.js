import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-T92: memory safety syntax of the C# 15 preview - `unsafe(expression)` and the `safe` modifier. PROVISIONAL:
// the pinned Roslyn does not implement either, so nothing here is a Roslyn fixture. Every expectation follows the
// pinned proposal revision csharplang/proposals/unsafe-evolution.md (commit 412dc302,
// packages/syntax/src/preview-revisions.js); each test names its section. Expected outputs are derived from the
// proposal: "The type and value of the unsafe_expression are the type and value of the enclosed expression."

const preview = { langVersion: 'preview', allowUnsafe: true };
const relevant = d => !/^SF1/.test(d.code) && d.code !== 'SF2098';
const found = (source, options = preview) =>
  compile(source, options)
    .diagnostics.filter(relevant)
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
function run(source) {
  const result = compile(source, preview);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error' && relevant(d)).map(d => d.code + ' ' + d.message), []);
  const il = compileToIL(source, { ...preview, includeDebug: false });
  return [new VirtualMachine(result.image).run().output, new CilVirtualMachine(il.assembly).run().output];
}
const main = 'static void Main() { }';

test('A02-T92 unsafe(expression) has the type and value of its operand ("unsafe expressions", Semantics)', () => {
  // The proposal's example: Console.WriteLine(unsafe(Add(1, 2))).
  const source =
    'using System; class Program { static int Add(int a, int b) { return a + b; } ' +
    'static void Main() { Console.WriteLine(unsafe(Add(1, 2))); int x = unsafe(Add(2, 3)) * 2; Console.WriteLine(x); } }';
  assert.deepEqual(run(source), ['3\n10\n', '3\n10\n']);
});

test('A02-T92 unsafe(expression) where an unsafe block cannot be written: field and constructor initializers', () => {
  const source =
    'using System; class C { public static int Start = unsafe(Seed()); public int V; public C(int v) { V = v; } ' +
    'public C() : this(unsafe(Seed() + 1)) { } static int Seed() { return 41; } } ' +
    'class Program { static void Main() { Console.WriteLine(C.Start); Console.WriteLine(new C().V); } }';
  assert.deepEqual(run(source), ['41\n42\n', '41\n42\n']);
});

test('A02-T92 the operand is bound in an unsafe context that ends at the closing parenthesis', () => {
  const type = body => `unsafe class Data { public static int* P = null; } class Program { static int M() { ${body} } ${main} }`;
  // A pointer dereference needs an unsafe context: the expression provides it, for its operand only.
  assert.deepEqual(found(type('return unsafe(*Data.P);')).filter(row => row.startsWith('CS')), []);
  assert.deepEqual(found(type('return *Data.P;')).filter(row => row.startsWith('CS')), ['CS0214:Data.P']);
  assert.deepEqual(found(type('return unsafe(1) + *Data.P;')).filter(row => row.startsWith('CS')), ['CS0214:Data.P']);
});

test('A02-T92 the same AllowUnsafeBlocks requirement as the unsafe keyword elsewhere (CS0227)', () => {
  const source = `class Program { static int M() { return unsafe(1); } ${main} }`;
  assert.deepEqual(found(source, { langVersion: 'preview' }), ['CS0227:unsafe']);
  assert.deepEqual(found(source), []);
});

test('A02-T92 the safe modifier: allowed where unsafe is, not together with it ("safe keyword")', () => {
  // "The safe modifier only marks the declaration as not requires-unsafe, it does not introduce a safe context."
  const source = 'using System; class Program { static safe int Twice(int x) { return x * 2; } static void Main() { Console.WriteLine(Twice(4)); } }';
  assert.deepEqual(run(source), ['8\n', '8\n']);
  const both = `class Program { static safe unsafe void M() { } ${main} }`;
  assert.deepEqual(found(both), ['SF2203:safe']);
  assert.match(compile(both, preview).diagnostics.find(d => d.code === 'SF2203').message, /unsafe-evolution\.md revision 1/);
});

test('A02-T92 both forms are gated below LangVersion preview (CS8652)', () => {
  const options = { langVersion: '14', allowUnsafe: true };
  assert(found(`class Program { static int M() { return unsafe(1); } ${main} }`, options).some(row => row.startsWith('CS8652:')));
  assert(found(`class Program { static safe void M() { } ${main} }`, options).some(row => row.startsWith('CS8652:')));
});
