import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T87: C# 14 partial constructors and events, user-defined compound assignment operators and lambda parameter
// modifiers without types. The Roslyn-pinned programs are the `partial-constructors-events`,
// `compound-assignment-operators` and `lambda-parameter-modifiers` fixtures of packages/compiler/test/differential.

const main = 'class Program { static void Main() { } }';
const errors = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
function run(source) {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message), []);
  const il = compileToIL(source, { includeDebug: false });
  const bytecode = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(il.assembly).run().output, bytecode);
  return bytecode;
}
const typeOf = (source, name) => analyze([parse(new SourceText(source, 'Program.cs'))]).assembly.types.find(t => t.name === name);

test('A02-T87 partial constructor: one symbol, the implementing part, with the defaults of the defining part', () => {
  const source = `partial class C { public partial C(int x, int y = 7); } partial class C { public partial C(int x, int y) { } } ${main}`,
    constructors = typeOf(source, 'C').getMembers('.ctor');
  assert.equal(constructors.length, 1);
  assert.equal(constructors[0].hasBody, true);
  assert.equal(constructors[0].parameters[1].isOptional, true);
  assert.equal(constructors[0].partialDefinitionPart.hasBody, false);
});

test('A02-T87 partial event: the part with accessors stays; the field-like defining part declares no field', () => {
  const source =
    `using System; partial class C { public partial event Action E; } ` +
    `partial class C { public partial event Action E { add { } remove { } } } ${main}`,
    events = typeOf(source, 'C').getMembers('E');
  assert.equal(events.length, 1);
  assert.equal(events[0].isFieldLike, false);
  assert.equal(events[0].partialDefinitionPart.isFieldLike, true);
});

test('A02-T87 partial constructors and events run on both back ends', () => {
  const source =
    'using System; partial class C { public partial C(int x, string label = "d"); public partial event Action Changed; } ' +
    'partial class C { int v; string l; Action h; public partial C(int x, string label) { v = x; l = label; } ' +
    'public partial event Action Changed { add { h += value; } remove { h -= value; } } public void Fire() { if (h != null) h(); Console.WriteLine(v + l); } } ' +
    'class Program { static void Main() { var c = new C(3); c.Changed += () => Console.Write("changed "); c.Fire(); } }';
  assert.equal(run(source), 'changed 3d\n');
});

test('A02-T87 partial member rules: CS9275, CS9276, CS9277, CS9280, CS0751', () => {
  const partial = body => `using System; partial class C { ${body} } ${main}`;
  assert.deepEqual(errors(partial('public partial C(int x);')), ['CS9275:C']);
  assert.deepEqual(errors(partial('public partial C(int x) { }')), ['CS9276:C']);
  assert.deepEqual(errors(partial('public partial event Action E; public partial event Action E; public partial event Action E { add { } remove { } }')), [
    'CS9277:E',
    'CS0102:E',
  ]);
  assert.deepEqual(errors(partial('public partial C(char a) : this(1); public partial C(char a) { } public partial C(int x); public partial C(int x) { }')), [
    'CS9280:: this(1)',
  ]);
  assert.deepEqual(errors(`class D { public partial D(); public partial D() { } } ${main}`), ['CS0751:D', 'CS0751:D']);
});

test('A02-T87 instance compound operators are instance methods under their metadata names', () => {
  const type = typeOf(`class A { public void operator +=(int x) { } public void operator ++() { } public static A operator ++(A a) { return a; } } ${main}`, 'A');
  const shape = name => type.getMembers(name).map(m => `${m.isStatic}:${m.parameters.length}:${!!m.isCompoundAssignmentOperator}`);
  assert.deepEqual(shape('op_AdditionAssignment'), ['false:1:true']);
  assert.deepEqual(shape('op_IncrementAssignment'), ['false:0:true']);
  assert.deepEqual(shape('op_Increment'), ['true:1:false']);
});

test('A02-T87 x op= y; and x++; call the instance operator and do not reassign x; without one the static operator is used', () => {
  const source =
    'using System; class Acc { public int V; public void operator +=(int x) { V += x; } public void operator ++() { V++; } ' +
    'public static Acc operator -(Acc a, int x) { return new Acc { V = a.V - x }; } } ' +
    'class Program { static void Main() { var a = new Acc(); var same = a; a += 5; a++; ++a; Console.Write(a.V + " " + (same == a) + " "); ' +
    'a -= 2; Console.WriteLine(a.V + " " + (same == a)); } }';
  assert.equal(run(source), '7 True 5 False\n');
});

test('A02-T87 compound operator rules: CS9308, CS9310, CS0106, CS9340; CS9260 and CS0019 below C# 14', () => {
  const type = body => `class Acc { ${body} } class Program { static void Main() { var a = new Acc(); MAIN } }`;
  assert.deepEqual(errors(type('void operator +=(int x) { }').replace('MAIN', '')), ['CS9308:+=']);
  assert.deepEqual(errors(type('public int operator -=(int x) { return 0; }').replace('MAIN', '')), ['CS9310:-=']);
  assert.deepEqual(errors(type('public static void operator /=(int x) { }').replace('MAIN', '')), ['CS0106:/=']);
  assert.deepEqual(errors(type('public void operator %=(string s) { }').replace('MAIN', 'a %= 1;')), ['CS9340:%=']);
  assert.deepEqual(errors(type('public void operator +=(int x) { }').replace('MAIN', 'a += 1;'), { langVersion: '13' }), ['CS9260:+=', 'CS0019:a += 1']);
});

test('A02-T87 limit: the value of an instance compound assignment falls back to the static operator', () => {
  const source = 'class Acc { public void operator +=(int x) { } } class Program { static void Main() { var a = new Acc(); var b = (a += 1); } }';
  // Roslyn calls the instance operator and reads `a`; here there is no static operator to fall back to: an error, never a wrong call.
  assert.deepEqual(errors(source), ['CS9340:+=']);
});

test('A02-T87 lambda parameter modifiers without types follow the delegate: CS1676, CS1677; CS9260 below C# 14', () => {
  const body = statements =>
    `using System; delegate bool TryParse(string text, out int result); delegate void Bump(ref int x); class Program { static void Main() { ${statements} } }`;
  assert.deepEqual(errors(body('TryParse p = (text, out result) => { result = text.Length; return true; }; Bump b = (ref x) => x++;')), []);
  assert.deepEqual(errors(body('Bump wrong = (out x) => { x = 1; };')), ['CS1676:x']);
  assert.deepEqual(errors(body('Func<int, int> f = (ref x) => x;')), ['CS1677:x']);
  assert.deepEqual(errors(body('TryParse q = (text, result) => true;')), ['CS1676:result']);
  assert.deepEqual(errors(body('Bump b = (ref x) => x++;'), { langVersion: '13' }), ['CS9260:ref x']);
});
