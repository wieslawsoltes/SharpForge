import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

const prelude = 'using System; using System.Linq.Expressions;';
const program = (body, members = '') => `${prelude} class Program { ${members} static void Main() { ${body} } }`;
const errors = source => analyze([parse(new SourceText(source, 'Program.cs'))]).diagnostics
  .filter(row => row.severity === 'error')
  .map(row => `${row.code}:${source.slice(row.start, row.start + row.length)}`);

test('A02-T07.5 Expression<T> requires a concrete delegate type before anonymous-method checks', () => {
  assert.deepEqual(errors(program('Expression<int> tree = () => 1;')), ['CS0835:=>']);
  assert.deepEqual(errors(program('Expression<Delegate> tree = () => 1;')), ['CS0835:=>']);
  assert.deepEqual(errors(program('Expression<int> tree = delegate { return 1; };')), ['CS0835:delegate']);
  assert.deepEqual(errors(program('', 'static void Make<T>() where T : Delegate { Expression<T> tree = () => { }; }')), ['CS0835:=>']);
  assert.deepEqual(errors(program('Expression<Func<int>> tree = delegate { return 1; };')), ['CS1946:delegate']);
});

test('A02-T07.5 only the actual expression-tree type accepts a lambda conversion', () => {
  const source = `${prelude} class Expression<T> { }
    class Program { static void Main() { Expression<Func<int>> tree = () => 1; } }`;
  assert.deepEqual(errors(source), ['CS1660:=>']);
  assert.deepEqual(errors(`${prelude} using Tree = System.Linq.Expressions.Expression<System.Func<int>>;
    class Program { static void Main() { Tree tree = () => 1; } }`), []);
});

test('A02-T07.5 anonymous objects are rejected in attribute and const-field declaration contexts', () => {
  const attribute = `${prelude} class NoteAttribute : Attribute { public NoteAttribute(object value) { } }
    [Note(new { Value = 1 })] class Program { static void Main() { } }`;
  assert.deepEqual(errors(attribute), ['CS0836:new']);
  assert.deepEqual(errors(program('', 'const object Value = new { Item = 1 };')), ['CS0836:new']);
});

test('A02-T07.5 anonymous objects remain valid in member initializers and expression-tree bodies', () => {
  assert.deepEqual(errors(program('Expression<Func<object>> tree = () => new { Value = 1 };',
    'static object Field = new { Value = 1 }; object Property { get; } = new { Value = 2 };')), []);
  const local = errors(program('const object value = new { Value = 1 };'));
  assert.ok(local.length > 0);
  assert.ok(local.every(row => !row.startsWith('CS0836:')), local.join('\n'));
});

test('A02-T07.5 bare function expressions cannot be operands of is or as', () => {
  for (const expression of ['M is object', 'M as object', '(() => 1) is object', '(() => 1) as object']) {
    assert.deepEqual(errors(program(`var result = ${expression};`, 'static int M() => 1;')), [`CS0837:${expression}`]);
  }
  assert.deepEqual(errors(program(`Func<int> value = M; bool first = value is object; object second = value as object;
    bool third = ((Func<int>)(() => 1)) is object;`, 'static int M() => 1;')), []);
});

test('A02-T07.5 rectangular array initializers in trees are rejected even when empty', () => {
  for (const creation of ['new int[,] { { 1, 2 } }', 'new int[0, 0] { }']) {
    assert.deepEqual(errors(program(`Expression<Func<int[,]>> tree = () => ${creation};`)), [`CS0838:${creation}`]);
  }
});

test('A02-T07.5 rectangular allocation and access and jagged initialization are valid tree forms', () => {
  assert.deepEqual(errors(program(`
    Expression<Func<int, int[,]>> allocate = size => new int[size, 2];
    Expression<Func<int[,], int>> read = values => values[0, 1];
    Expression<Func<int[][]>> jagged = () => new int[][] { new int[] { 1, 2 } };
    Func<int[,]> ordinary = () => new int[,] { { 1, 2 } };
  `)), []);
});
