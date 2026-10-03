import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';

// COM interop in the language (SF-A02-T56). The Roslyn-pinned programs are the `com-interop` fixtures of
// packages/compiler/test/differential.

const types = `
  [ComImport, Guid("00000000-0000-0000-0000-000000000001"), CoClass(typeof(WidgetClass))]
  interface IWidget { void Update(ref int value, ref string name); void Out(out int value); }
  [ComImport, Guid("00000000-0000-0000-0000-000000000002")] class WidgetClass { }
  interface IPlain { void Update(ref int value); }`;
const program = (body, declarations = types) =>
  `using System; using System.Runtime.InteropServices; ${declarations} ` +
  `class P { static void Use(IWidget w, IPlain p) { int i = 1; string s = "a"; ${body} } static void Main() { } }`;

function codesOf(source) {
  return compile(source)
    .diagnostics.filter(d => d.code.startsWith('CS') && d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}

test('ref may be omitted on a call to a COM interface method, by value or mixed with ref', () => {
  assert.deepEqual(codesOf(program('w.Update(i, s); w.Update(ref i, s); w.Update(1, "x"); w.Update(i + 1, name: s);')), []);
});

test('out cannot be omitted, the argument must convert, and other interfaces keep the rule', () => {
  assert.deepEqual(codesOf(program('w.Out(i);')), ['CS1620:i']);
  assert.deepEqual(codesOf(program('object o = 1; w.Update(o, s);')), ['CS1620:o']);
  assert.deepEqual(codesOf(program('p.Update(i);')), ['CS1620:i']);
});

test('new on a COM interface creates its coclass; without a coclass it is CS0144', () => {
  assert.deepEqual(codesOf(program('IWidget made = new IWidget();')), []);
  assert.deepEqual(codesOf(program('var made = new IPlain();')), ['CS0144:new IPlain()']);
});

test('ComImport declarations: Guid required and well formed, no base class, no constructor, extern members only', () => {
  const declare = text => program('', types + text);
  assert.deepEqual(codesOf(declare('[ComImport] interface INoGuid { }')), ['CS0596:ComImport']);
  assert.deepEqual(codesOf(declare('[Guid("not-a-guid")] class Bad { }')), ['CS0591:"not-a-guid"']);
  const guid = '[ComImport, Guid("00000000-0000-0000-0000-000000000009")]';
  assert.deepEqual(codesOf(declare(`class B { } ${guid} class D : B { }`)), ['CS0424:D']);
  assert.deepEqual(codesOf(declare(`${guid} class C { public C() { } }`)), ['CS0669:C']);
  assert.deepEqual(codesOf(declare(`${guid} class C { public void M() { } public extern void N(); }`)), ['CS0423:M']);
});

test('nothing COM runs: a valid COM program is SF2200 without a false C# error', () => {
  const result = compile(program('IWidget made = new IWidget(); made.Update(1, "x");'));
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS')), []);
  assert.ok(result.diagnostics.some(d => d.code === 'SF2200'));
});
