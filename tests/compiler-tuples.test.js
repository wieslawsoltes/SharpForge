import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { tupleElement, tupleElementIndex, tupleLiteralNames, tupleNameProblems } from '../packages/compiler/src/binder/tuples.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable, runOnBothBackEnds } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n  static void Main() {\n${body}\n  }\n}\n`;

/** The bound nodes of a kind in the program's Main, with the analysis diagnostics. */
function boundNodes(source, kind) {
  const file = parse(new SourceText(source, 'Program.cs'));
  const analysis = analyze([file], {});
  const found = [];
  for (const body of analysis.bound.values()) walk(body, node => void (node.kind === kind && found.push(node)));
  return { found, analysis };
}

test('SF-A02-T08.4 corpus: every tuple fixture matches Roslyn and .NET on both back ends', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'tuple-lowering');
  assert.ok(fixtures.length >= 11);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T08.4 a tuple type is a construction of ValueTuple whose elements are the fields Item1..ItemN', () => {
  const { found, analysis } = boundNodes(program('(int id, string name) t = (1, "x"); Console.WriteLine(t.name + t.Item1);'), 'FieldAccess');
  assert.deepEqual(analysis.diagnostics, []);
  assert.equal(analysis.incomplete, false);
  const [byName, byItem] = found;
  assert.equal(byName.field.name, 'Item2', 'a named element binds to the field at its position');
  assert.equal(tupleElementIndex(byName.field), 1);
  assert.equal(tupleElementIndex(byItem.field), 0);
  const type = byName.receiver.type;
  assert.equal(type.isTupleType, true);
  assert.equal(type.originalDefinition.metadataFullName, 'System.ValueTuple`2');
  assert.equal(type.toDisplayString(), '(int id, string name)');
  assert.deepEqual(tupleElement(type, 'id'), { field: 'Item1', index: 0, isInferred: false });
  assert.equal(tupleElement(type, 'Item3'), null);
  assert.equal(tupleElement(type, 'ToString'), null);
});

test('SF-A02-T08.4 element names: explicit names are checked, usable names are inferred from the elements', () => {
  assert.deepEqual(tupleNameProblems(['a', null, 'a', 'Item1', 'Rest', 'Item6']), [
    { index: 2, code: 'CS8127', args: [] },
    { index: 3, code: 'CS8125', args: ['Item1', 1] },
    { index: 4, code: 'CS8126', args: ['Rest'] },
  ]);
  const argumentsOf = text => {
    const { found } = boundNodes(program(`int a = 1, b = 2; string s = "x"; var t = ${text}; Console.WriteLine(a + b + s);`), 'Tuple');
    return tupleLiteralNames(found[0].syntax.arguments);
  };
  assert.deepEqual(argumentsOf('(a, b)'), { names: ['a', 'b'], inferred: [true, true] });
  assert.deepEqual(argumentsOf('(a, x: b)'), { names: ['a', 'x'], inferred: [true, false] });
  assert.deepEqual(argumentsOf('(a, a)').names, [null, null], 'an ambiguous inferred name is dropped');
  assert.deepEqual(argumentsOf('(s.Length, a + b)').names, ['Length', null]);
  assert.deepEqual(argumentsOf('(a, a: b)').names, [null, 'a'], 'an explicit name wins over an inferred one');
});

test('SF-A02-T08.4 tuples are objects of one synthesized class per shape; names do not make a new class', () => {
  const { image } = runOnBothBackEnds(
    program('(int a, int b) x = (1, 2); (int, int) y = x; var z = (c: 3, d: "s"); Console.WriteLine(x.a + y.Item2 + z.d);'),
  );
  const tuples = image.types.filter(t => t.name.startsWith('ValueTuple(')).map(t => t.name);
  assert.deepEqual(tuples.sort(), ['ValueTuple(int;int)', 'ValueTuple(int;string)']);
  const pair = image.types.find(t => t.name === 'ValueTuple(int;int)');
  assert.deepEqual(
    pair.fields.map(f => f.name + ':' + f.type),
    ['Item1:int', 'Item2:int'],
  );
});

test('SF-A02-T08.4 a store into an element replaces the tuple in its variable: copies keep their value', () => {
  const lines = linesOf(`
    using System;
    class Box { public (int, (int, int)) Value; }
    class Program {
      static void Main() {
        var box = new Box();
        var seen = box.Value;
        box.Value.Item2.Item1 = 5;
        var copy = box.Value;
        copy.Item2.Item2++;
        Console.WriteLine(seen);
        Console.WriteLine(box.Value);
        Console.WriteLine(copy);
      }
    }`);
  assert.deepEqual(lines, ['(0, (0, 0))', '(0, (5, 0))', '(0, (5, 1))']);
});

test('SF-A02-T08.4 the receiver and index of an element store are evaluated once', () => {
  const lines = linesOf(`
    using System;
    class Program {
      static int calls;
      static (int, int)[] items = new (int, int)[2];
      static (int, int)[] Items() { calls++; return items; }
      static int Index() { calls += 10; return 1; }
      static void Main() {
        Items()[Index()].Item2 += 7;
        Items()[Index()].Item1++;
        Console.WriteLine(items[1]);
        Console.WriteLine(calls);
      }
    }`);
  assert.deepEqual(lines, ['(1, 7)', '22']);
});

test('SF-A02-T08.4 tuple equality binds one operator per pair of elements', () => {
  const { found, analysis } = boundNodes(program('var t = (1, "a"); Console.WriteLine(t == (1L, null));'), 'Binary');
  assert.deepEqual(analysis.diagnostics, []);
  const comparison = found.find(node => node.family === 'tuple');
  assert.equal(comparison.operation.elements.length, 2);
  assert.equal(comparison.operation.elements[0].left.type.toDisplayString(), 'long', 'the int element is widened for its pair');
  assert.equal(comparison.operation.elements[1].operator, '==');
  assert.equal(comparison.operation.leftParts[0].kind, 'TupleElementPlaceholder');
});

test('SF-A02-T08.4 what needs virtual dispatch or a wider tuple is reported, not guessed', () => {
  const boxed = notExecutable(program('object o = (1, 2); Console.WriteLine(o);'));
  assert.match(boxed.message, /converting '\(int, int\)' to 'object'/);
  const member = notExecutable('using System;\nclass Item { }\n' + program('var t = (1, new Item()); Console.WriteLine(t);').slice(14));
  assert.match(member.message, /text of a member of type 'Item'/);
});
