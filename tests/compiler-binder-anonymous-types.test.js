import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { anonymousTypeOf, inferredMemberName } from '../packages/compiler/src/symbols/synthesized/anonymous-types.js';

// SF-A02-T53: anonymous types. The Roslyn-pinned programs are the `anonymous-types` fixtures of
// packages/compiler/test/differential; these tests cover identity, name inference and the boundaries.

const type = name => ({ name, equals: other => other.name === name, toDisplayString: () => name });
const int = type('int'),
  string = type('string');
const core = { object: type('object') };

function expressionOf(text) {
  const file = parse(new SourceText(`class P { void M() { F(${text}); } }`, 'a.cs'));
  let found = null;
  const visit = node => {
    if (found) return;
    if (node.kind === 'Argument') found = node.expression;
    else for (const child of node.childNodes?.() ?? []) visit(child);
  };
  visit(file.syntax);
  return found;
}

const program = body => `using System; class C { public int X = 4; public static void M() { } } class P { static void Main() { var c = new C(); ${body} } }`;
function run(body) {
  const source = program(body),
    result = compile(source);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message),
    [],
  );
  const il = compileToIL(source, { includeDebug: false });
  assert.equal(il.success, true);
  const output = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(il.assembly).run().output, output);
  return output;
}
const codes = body => {
  const source = program(body);
  return compile(source)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};

test('A02-T53 identity: the same names, types and order are one type per compilation', () => {
  const driver = {};
  const first = anonymousTypeOf(driver, core, [{ name: 'A', type: int }, { name: 'B', type: string }]);
  assert.equal(anonymousTypeOf(driver, core, [{ name: 'A', type: int }, { name: 'B', type: string }]), first);
  assert.notEqual(anonymousTypeOf(driver, core, [{ name: 'B', type: string }, { name: 'A', type: int }]), first);
  assert.notEqual(anonymousTypeOf(driver, core, [{ name: 'A', type: string }, { name: 'B', type: string }]), first);
  assert.notEqual(anonymousTypeOf(driver, core, [{ name: 'A', type: int }]), first);
  // Another compilation has its own types.
  assert.notEqual(anonymousTypeOf({}, core, [{ name: 'A', type: int }, { name: 'B', type: string }]), first);
});

test('A02-T53 the type is displayed as Roslyn displays it and has one read-only property per member', () => {
  const symbol = anonymousTypeOf({}, core, [{ name: 'A', type: int }, { name: 'B', type: string }]);
  assert.equal(symbol.toDisplayString(), '<anonymous type: int A, string B>');
  assert.equal(anonymousTypeOf({}, core, []).toDisplayString(), '<empty anonymous type>');
  const property = symbol.getMembers('A').find(member => member.getMethod);
  assert.equal(property.type, int);
  assert.equal(property.setMethod ?? null, null);
});

test('A02-T53 a member name is inferred from a name, a member access or a null-conditional member', () => {
  assert.equal(inferredMemberName(expressionOf('local')), 'local');
  assert.equal(inferredMemberName(expressionOf('a.b.Name')), 'Name');
  assert.equal(inferredMemberName(expressionOf('a?.Name')), 'Name');
  assert.equal(inferredMemberName(expressionOf('a?.b?.Name')), 'Name');
  for (const text of ['1', 'a + b', 'M()', 'a.M()', 'a[0]', 'new C()']) assert.equal(inferredMemberName(expressionOf(text)), null, text);
});

test('A02-T53 creation, member reads and text on both back ends', () => {
  assert.equal(run('var a = new { Name = "x", c.X }; Console.WriteLine(a.Name + a.X); Console.WriteLine(a);'), 'x4\n{ Name = x, X = 4 }\n');
  assert.equal(run('Console.WriteLine(new { }); Console.WriteLine($"[{new { N = new { V = 1.5 }, B = true }}]");'), '{ }\n[{ N = { V = 1.5 }, B = True }]\n');
});

test('A02-T53 Equals is member-wise, == is reference equality', () => {
  const body =
    'var a = new { A = 1, S = "s" }; var b = new { A = 1, S = "s" }; var d = new { A = 2, S = "s" }; ' +
    'Console.WriteLine(a.Equals(b) + " " + a.Equals(d) + " " + a.Equals(null) + " " + (a == b) + " " + (a != b));';
  assert.equal(run(body), 'True False False False True\n');
});

test('A02-T53 values are evaluated in the order they are written', () => {
  const source =
    'using System; class P { static int n; static int Next() { n++; return n; } ' +
    'static void Main() { var a = new { Second = Next(), First = Next() }; Console.WriteLine(a.Second + " " + a.First); } }';
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(new VirtualMachine(result.image).run().output, '1 2\n');
});

test('A02-T53 member declarators that declare no property', () => {
  assert.deepEqual(codes('var a = new { 1 };'), ['CS0746:1']);
  assert.deepEqual(codes('var a = new { c.X, X = 2 };'), ['CS0833:X = 2']);
  assert.deepEqual(codes('var a = new { N = null };'), ['CS0828:N = null']);
  assert.deepEqual(codes('var a = new { F = C.M };'), ['CS0828:F = C.M']);
  assert.deepEqual(codes('var a = new { A = 1 }; a.A = 2;'), ['CS0200:a.A']);
});

test('A02-T53 what needs the run-time type is SF2200, never a wrong result', () => {
  for (const body of ['var a = new { A = 1 }; object o = a; Console.WriteLine(o);', 'Console.WriteLine(new { A = 1 }.GetHashCode());']) {
    const result = compile(program(body));
    assert.equal(result.success, false, body);
    assert.equal(result.image, null);
    assert(result.diagnostics.some(d => d.code === 'SF2200'), body);
  }
});
