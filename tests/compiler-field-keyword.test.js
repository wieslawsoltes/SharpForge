import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T84: the C# 14 `field` keyword in bound-tree form. The Roslyn-pinned programs are the `field-keyword`
// fixtures of packages/compiler/test/differential; these tests look at the symbols, the bound tree and the rules.

const analysed = source => {
  const file = parse(new SourceText(source, 'Program.cs'));
  return analyze([file]);
};
const codes = (source, options) => compile(source, options).diagnostics.filter(d => /^CS/.test(d.code)).map(d => `${d.code}:${d.severity}`);
const main = 'class Program { static void Main() { } }';
function run(source) {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message), []);
  const il = compileToIL(source, { includeDebug: false });
  const bytecode = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(il.assembly).run().output, bytecode);
  return bytecode;
}

test('A02-T84 symbols: a property that uses field has a writable synthesized backing field; bodiless accessors are auto-implemented', () => {
  const result = analysed(`class C { public int P { get; set => field = value; } public int Q { get { return 1; } } public int R { get => field; } } ${main}`),
    type = result.assembly.types.find(t => t.name === 'C'),
    property = name => type.getMembers(name)[0];
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  assert.equal(property('P').backingField.name, '<P>k__BackingField');
  assert.equal(property('P').usesFieldKeyword, true);
  assert.equal(property('P').getMethod.isAutoAccessor, true);
  assert.equal(property('P').setMethod.isAutoAccessor, false);
  assert.equal(property('Q').backingField, null);
  // A getter may assign `field` (a lazy getter): the field of a getter-only property is not readonly.
  assert.equal(property('R').backingField.isReadOnly, false);
});

test('A02-T84 bound tree: field is a FieldAccess of the backing field on this', () => {
  const result = analysed(`class C { public int P { get => field; set => field = value; } } ${main}`),
    type = result.assembly.types.find(t => t.name === 'C'),
    property = type.getMembers('P')[0],
    body = result.bound.get(property.getMethod);
  assert.equal(body.expression.kind === 'Conversion' ? body.expression.operand.kind : body.expression.kind, 'FieldAccess');
  const access = body.expression.field ? body.expression : body.expression.operand;
  assert.equal(access.field, property.backingField);
  assert.equal(access.receiver.kind, 'This');
});

test('A02-T84 runs through the semantic pipeline: generic owner, initializer, lazy getter, static property', () => {
  const source =
    'using System; class S<T> { public T V { get => field; set => field = value; } public int N { get; set => field = value + 1; } = 3; ' +
    'public int Lazy { get { if (field == 0) field = 42; return field; } } public static int Count { get => field; set => field = value * 2; } } ' +
    'class Program { static void Main() { var s = new S<string>(); s.V = "v"; s.N = 5; S<string>.Count = 4; ' +
    'Console.WriteLine(s.V + new S<int>().N + s.N + s.Lazy + S<string>.Count); } }';
  assert.equal(run(source), 'v36428\n');
});

test('A02-T84 CS9258 warns when a member named field is in scope; @field and this.field are the member', () => {
  const source = `class C { int field = 9; public int P { get => field; } public int Q { get { return @field + this.field; } } } ${main}`;
  assert.deepEqual(codes(source).filter(c => c.startsWith('CS9258')), ['CS9258:warning']);
  assert.deepEqual(codes(`class C { public int P { get => field; set => field = value; } } ${main}`), []);
});

test('A02-T84 field outside a property accessor is an ordinary name: CS0103', () => {
  assert.deepEqual(codes(`class C { int M() { return field; } public int this[int i] { get => field; } } ${main}`), ['CS0103:error', 'CS0103:error']);
});

test('A02-T84 initializers: allowed on a property that uses field, CS8050 otherwise', () => {
  assert.deepEqual(codes(`class C { public int A { get => field; } = 2; } ${main}`), []);
  assert.deepEqual(codes(`class C { public int A { get { return 1; } } = 1; } ${main}`), ['CS8050:error']);
});

test('A02-T84 below C# 14 field is an ordinary name: it binds to a member named field, or is CS0103 (as Roslyn)', () => {
  // The Roslyn-pinned programs are field-keyword/csharp13-member-named-field and csharp13-no-member-named-field.
  const withMember = `using System; class C { int field = 5; public int P { get { return field; } set { field = value * 2; } } } ` +
    'class Program { static void Main() { var c = new C(); Console.WriteLine(c.P); c.P = 7; Console.WriteLine(c.P); } }';
  const result = compile(withMember, { langVersion: '13' });
  assert.deepEqual(codes(withMember, { langVersion: '13' }), []);
  assert.equal(new VirtualMachine(result.image).run().output, '5\n14\n');
  assert.equal(new CilVirtualMachine(compileToIL(withMember, { langVersion: '13', includeDebug: false }).assembly).run().output, '5\n14\n');
  assert.deepEqual(codes(`class C { public int P { get { return field; } } } ${main}`, { langVersion: '13' }), ['CS0103:error']);
  // A local named field is fine there, and an auto accessor next to a bodied one is the gated part (on the name).
  assert.deepEqual(codes(`class C { public int L { get { int field = 1; return field; } } } ${main}`, { langVersion: '13' }), []);
  assert.deepEqual(codes(`class C { public int M { get; set { } } } ${main}`, { langVersion: '13' }), ['CS9260:error']);
});

test('A02-T84 the string-typed profile does not bind the keyword: such a property is compiled by the semantic pipeline', () => {
  // A program inside the profile except for `field`: it still runs on both back ends, through one implementation.
  const source =
    'using System; class C { public int P { get => field; set => field = value + 1; } public int Q { get; set => field = value * 2; } } ' +
    'class Program { static void Main() { var c = new C(); c.P = 4; c.Q = 4; Console.WriteLine(c.P + " " + c.Q); } }';
  assert.equal(run(source), '5 8\n');
  assert.deepEqual(codes(`class C { public int P { get { int field = 1; return 2; } } } ${main}`).filter(code => code.endsWith(':error')), ['CS9273:error']);
});
