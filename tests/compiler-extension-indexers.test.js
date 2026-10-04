import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-T91: extension indexers (C# 15 preview). PROVISIONAL: the pinned Roslyn rejects an indexer in an extension
// block (CS9282), so nothing here is a Roslyn fixture. Every expectation follows the pinned proposal revision
// csharplang/proposals/csharp-15.0/extension-indexers.md (packages/syntax/src/preview-revisions.js, commit 412dc302);
// each test names the section. Expected outputs are derived from the proposal's semantics: an access is the call
// of the static get_Item / set_Item implementation with the receiver as the first argument.

const preview = { langVersion: 'preview' };
// The string-typed pipeline adds its profile codes next to an error (SF1xxx, SF2005 indexers, SF2098 expressions).
const relevant = d => !/^SF1/.test(d.code) && d.code !== 'SF2005' && d.code !== 'SF2098';
const found = source =>
  compile(source, preview)
    .diagnostics.filter(relevant)
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const outputs = source => {
  const result = compile(source, preview);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error' && relevant(d)).map(d => d.code), [], source);
  const il = compileToIL(source, { ...preview, includeDebug: false });
  return [new VirtualMachine(result.image).run().output, new CilVirtualMachine(il.assembly).run().output];
};
const bag = 'class Bag { public int[] Items = new int[4]; } ';
const program = (extensions, body, types = bag) =>
  `using System; ${types}static class E { ${extensions} } class Program { static void Main() { ${body} } }`;
const bagIndexer = 'extension(Bag b) { public int this[int index] { get { return b.Items[index]; } set { b.Items[index] = value; } } }';

test('A02-T91 an access calls get_Item, an assignment set_Item, with the receiver first ("Extension indexer access")', () => {
  const source = program(bagIndexer, 'Bag b = new Bag(); b[1] = 5; b[1] += 2; b[2]++; Console.WriteLine(b[1]); Console.WriteLine(b[2]);');
  // b[1] = 5 then b[1] += 2 reads 5 and stores 7; b[2]++ reads 0 and stores 1.
  assert.deepEqual(outputs(source), ['7\n1\n', '7\n1\n']);
});

test('A02-T91 the implementation methods are ordinary static methods ("Metadata": get_Item(receiver, index))', () => {
  const source = program(bagIndexer, 'Bag b = new Bag(); E.set_Item(b, 3, 9); Console.WriteLine(b[3]); Console.WriteLine(E.get_Item(b, 3));');
  assert.deepEqual(outputs(source), ['9\n9\n', '9\n9\n']);
});

test('A02-T91 overload resolution over the indexers of a scope, and a receiver of a simple type', () => {
  const extensions =
    bagIndexer +
    ' extension(Bag b) { public string this[string key] => key + "!"; }' +
    ' extension(int i) { public bool this[int bit] { get { return ((i >> bit) & 1) == 1; } } }';
  const source = program(extensions, 'Bag b = new Bag(); int five = 5; Console.WriteLine(b["k"]); Console.WriteLine(five[0]); Console.WriteLine(five[1]);');
  // 5 is binary 101: bit 0 is set, bit 1 is not.
  assert.deepEqual(outputs(source), ['k!\nTrue\nFalse\n', 'k!\nTrue\nFalse\n']);
});

test('A02-T91 the type arguments of the block are inferred from the receiver and the arguments', () => {
  const extensions = 'extension<T>(T t) { public string this[T other, int n] => n + ":" + (other != null); }';
  assert.deepEqual(outputs(program(extensions, 'Bag b = new Bag(); Console.WriteLine(b[b, 3]);')), ['3:True\n', '3:True\n']);
});

test('A02-T91 null-conditional element access defers to the same binding ("Other element-access forms")', () => {
  const body = 'Bag none = null; Bag some = new Bag(); some[0] = 4; Console.WriteLine(none?[0] == null); Console.WriteLine(some?[0]);';
  assert.deepEqual(outputs(program(bagIndexer, body)), ['True\n4\n', 'True\n4\n']);
});

test('A02-T91 an instance indexer of the receiver type wins ("Indexer access", step 1)', () => {
  const types = 'class Own { public int this[int i] { get { return 1; } } } ';
  const extensions = 'extension(Own o) { public int this[int i] { get { return 2; } } public int this[string s] { get { return 3; } } }';
  // The instance indexer is applicable for an int; for a string no instance indexer applies, so the extension is used.
  assert.deepEqual(outputs(program(extensions, 'Own o = new Own(); Console.WriteLine(o[0]); Console.WriteLine(o["x"]);', types)), ['1\n3\n', '1\n3\n']);
});

test('A02-T91 no extension indexers on arrays or strings', () => {
  // "Decision: no extension indexers on strings or arrays": the element access keeps its own rules and errors.
  const extensions = 'extension(int[] a) { public int this[string key] { get { return 0; } } } extension(string s) { public int this[bool b] { get { return 0; } } }';
  assert.deepEqual(found(program(extensions, 'int[] a = new int[1]; int x = a["k"];', '')), ['CS0029:"k"']);
  assert.equal(compile(program(extensions, 'int y = "s"[true];', ''), preview).success, false);
});

test('A02-T91 an ambiguous extension indexer access is an error', () => {
  // Two classes of one scope each declare an applicable indexer and neither is better.
  const other = bag + 'static class F { extension(Bag c) { public int this[int j] { get { return 2; } } } } ';
  assert.deepEqual(found(program(bagIndexer, 'Bag b = new Bag(); int x = b[0];', other)), ['CS9339:b[0]']);
});

test('A02-T91 when no extension indexer applies the error of the normal processing stands', () => {
  assert.deepEqual(found(program(bagIndexer, 'Bag b = new Bag(); int x = b["k"];')), ['CS0021:b["k"]']);
});

test('A02-T91 not bound: the implicit Index / Range form and framework types with indexers of their own (SF2202)', () => {
  const implicit = program(bagIndexer, 'Bag b = new Bag(); int x = b[^1];');
  assert.deepEqual(found(implicit), ['SF2202:b[^1]']);
  const framework = program(
    'extension(System.Collections.Generic.List<int> l) { public int this[string key] { get { return 0; } } }',
    'var l = new System.Collections.Generic.List<int>(); int x = l["k"];',
    '',
  );
  assert.deepEqual(found(framework), ['SF2202:l["k"]']);
  assert.match(compile(framework, preview).diagnostics.find(d => d.code === 'SF2202').message, /extension-indexers\.md revision 1/);
});

test('A02-T91 declaration rules ("Declaration")', () => {
  const declared = extensions => found(program(extensions, '', ''));
  // "an extension block that declares an indexer must provide a named receiver parameter"
  assert.deepEqual(declared('extension(int) { public int this[int j] { get { return 0; } } }'), ['CS9303:this']);
  // "cannot specify ... protected ... or init accessors"
  assert.deepEqual(declared('extension(int i) { protected int this[int j] { get { return 0; } } }'), ['CS9302:this']);
  assert.deepEqual(declared('extension(int i) { public int this[int j] { get { return 0; } init { } } }'), ['CS9304:init']);
  // "indexers are always instance members"
  assert.deepEqual(declared('extension(int i) { public static int this[int j] { get { return 0; } } }'), ['CS0106:this']);
  // "all the type parameters of its extension block must be used in the combined set of parameters"
  assert.deepEqual(declared('extension<T>(int i) { public int this[int j] { get { return 0; } } }'), ['CS9295:this']);
  assert.deepEqual(declared('extension<T>(int i) { public int this[T t] { get { return 0; } } }'), []);
  // Like an extension property, an indexer needs accessor bodies.
  assert.deepEqual(declared('extension(int i) { public int this[int j] { get; } }'), ['CS9282:this']);
});

test('A02-T91 an extension indexer cannot be captured in an expression tree ("Expression trees")', () => {
  const body = 'System.Linq.Expressions.Expression<Func<Bag, int>> tree = b => b[0];';
  assert.deepEqual(found(program(bagIndexer, body)), ['SF2203:b[0]']);
  assert.deepEqual(found(program(bagIndexer, 'Func<Bag, int> f = b => b[0];')), []);
});
