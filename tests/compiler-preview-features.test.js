import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-E12: C# 15 preview semantics. PROVISIONAL: the pinned Roslyn implements none of these features, so there
// is no Roslyn fixture; the expectations are the rules of the pinned csharplang proposal revisions
// (packages/syntax/src/preview-revisions.js). Each test names the rule it checks.

const preview = { langVersion: 'preview' };
// The string-typed pipeline adds its profile codes (SF1xxx) next to an error; they are not what these tests are about.
const relevant = d => !/^SF1/.test(d.code);
const diagnostics = (source, options = preview) =>
  compile(source, options)
    .diagnostics.filter(relevant)
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const errorCodes = (source, options = preview) =>
  compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && relevant(d))
    .map(d => d.code);
const main = 'class Program { static void Main() { } }';

test('A02-E12 every preview feature is rejected below LangVersion preview (CS8652)', () => {
  const sources = [
    `union Shape(int, string); ${main}`,
    `closed class A { } ${main}`,
    `closed enum E { A } ${main}`,
    'class Program { static safe void M() { } static void Main() { } }',
    'class Program { static void Main() { int a = unsafe(1); } }',
    `static class X { extension(int[] a) { public int this[string key] { get { return 0; } } } } ${main}`,
  ];
  for (const source of sources) assert(errorCodes(source, { langVersion: '14' }).includes('CS8652'), source);
});

test('A02-T90 closed enum: a switch expression that handles all members is exhaustive, on both back ends', () => {
  const source =
    'using System; closed enum E { A, B } class Program { static int F(E e) { return e switch { E.A => 1, E.B => 2 }; } ' +
    'static void Main() { Console.WriteLine(F(E.A) + F(E.B)); } }';
  const result = compile(source, preview);
  assert.deepEqual(result.diagnostics.map(d => d.code), []);
  const il = compileToIL(source, { ...preview, includeDebug: false });
  assert.equal(new VirtualMachine(result.image).run().output, '3\n');
  assert.equal(new CilVirtualMachine(il.assembly).run().output, '3\n');
  // An ordinary enum keeps the warning for unnamed values, and a closed enum still needs every member.
  assert.deepEqual(compile(source.replace('closed enum', 'enum'), preview).diagnostics.map(d => d.code), ['CS8524']);
  assert.deepEqual(compile(source.replace(', E.B => 2', ''), preview).diagnostics.map(d => d.code), ['CS8509']);
});

test('A02-T90 closed enum: must declare a member for the value 0', () => {
  assert.deepEqual(diagnostics(`closed enum E { A = 1, B } ${main}`), ['SF2203:E']);
  assert.deepEqual(diagnostics(`closed enum E { A = 1, None = 0 } ${main}`), []);
});

test('A02-T90 closed class: implicitly abstract; sealed, static and an explicit abstract are errors', () => {
  assert.deepEqual(errorCodes('closed class A { } class Program { static void Main() { var a = new A(); } }'), ['CS0144']);
  assert.deepEqual(diagnostics(`closed sealed class S { } ${main}`), ['SF2203:S']);
  assert.deepEqual(diagnostics(`closed abstract class T { } ${main}`), ['SF2203:T']);
  const message = compile(`closed sealed class S { } ${main}`, preview).diagnostics.find(d => d.code === 'SF2203').message;
  assert.match(message, /provisional: csharplang\/proposals\/csharp-15\.0\/closed-hierarchies\.md revision 1/);
});

test('A02-T89 union declarations require the framework contracts specified by the pinned proposal', () => {
  const source = `union Shape(int, string); ${main}`;
  const result = compile(source, preview);
  assert.equal(result.success, false);
  assert.equal(result.diagnostics.filter(diagnostic => diagnostic.code === 'CS0518').length, 2);
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === 'SF2202'), false);
});
