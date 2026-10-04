import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import {
  tupleElement,
  tupleElementIndex,
  tupleElementNamesOf,
  tupleElements,
  isWideTuple,
} from '../packages/compiler/src/binder/tuples.js';
import { applyTupleElementNames } from '../packages/compiler/src/metadata-import/attributes.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n  static void Main() {\n${body}\n  }\n}\n`;
const analysisOf = source => analyze([parse(new SourceText(source, 'Program.cs'))], {});
const errorsOf = analysis => analysis.diagnostics.filter(d => d.severity === 'error').map(d => d.code);

function boundNodes(source, kind) {
  const analysis = analysisOf(source),
    found = [];
  for (const body of analysis.bound.values()) walk(body, node => void (node.kind === kind && found.push(node)));
  return { found, analysis };
}

/** The types of the fields of class `name`, by field name. */
function fieldTypes(analysis, name) {
  const type = analysis.assembly.types.find(candidate => candidate.name === name);
  return Object.fromEntries(type.getMembers().filter(member => member.kind === 'Field').map(field => [field.name, field.type]));
}

test('SF-A02-T08.4 corpus: every wide tuple fixture matches Roslyn and .NET on both back ends', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'tuple-wide');
  assert.ok(fixtures.length >= 7);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T08.4 a tuple of nine elements is ValueTuple`8 whose eighth argument is the tuple of the rest', () => {
  const { found, analysis } = boundNodes(
    program('(int a, int b, int c, int d, int e, int f, int g, int h, string i) t = (1, 2, 3, 4, 5, 6, 7, 8, "x"); Console.WriteLine(t.i + t.Item1 + t.Rest.Item1);'),
    'FieldAccess',
  );
  assert.deepEqual(errorsOf(analysis), []);
  assert.equal(analysis.incomplete, false);
  const [byName, byItem, restItem] = found,
    type = byName.receiver.type;
  assert.equal(type.originalDefinition.metadataFullName, 'System.ValueTuple`8');
  assert.equal(type.typeArguments.length, 8);
  assert.equal(isWideTuple(type), true);
  assert.equal(tupleElements(type).length, 9);
  assert.equal(type.toDisplayString(), '(int a, int b, int c, int d, int e, int f, int g, int h, string i)');
  // The ninth element is a field of the tuple type that stands for Rest.Item2.
  assert.equal(byName.field.name, 'Item9');
  assert.equal(byName.type.specialType, 'System_String');
  assert.equal(tupleElementIndex(byName.field), 8);
  assert.equal(tupleElement(type, 'Item9').symbol, byName.field, 'one symbol per element of a tuple type');
  assert.equal(tupleElementIndex(byItem.field), 0);
  // Rest is the nested tuple: it has no names of its own.
  const rest = restItem.receiver;
  assert.equal(rest.field.name, 'Rest');
  assert.equal(rest.type.originalDefinition.metadataFullName, 'System.ValueTuple`2');
  assert.equal(rest.type.toDisplayString(), '(int, string)');
  assert.equal(rest.type.equals(type.typeArguments[7].type), true);
});

test('SF-A02-T08.4 boundaries: seven elements do not nest, eight nest a ValueTuple`1, sixteen nest twice', () => {
  const analysis = analysisOf(`class C {
  public (int, int, int, int, int, int, int) Seven;
  public (int, int, int, int, int, int, int, int) Eight;
  public (int, int, int, int, int, int, int, int, int, int, int, int, int, int, int, int) Sixteen;
}`);
  const { Seven, Eight, Sixteen } = fieldTypes(analysis, 'C');
  assert.equal(isWideTuple(Seven), false);
  assert.equal(Seven.originalDefinition.metadataFullName, 'System.ValueTuple`7');
  assert.equal(tupleElement(Seven, 'Item8'), null);
  assert.equal(isWideTuple(Eight), true);
  assert.equal(Eight.typeArguments[7].type.originalDefinition.metadataFullName, 'System.ValueTuple`1');
  assert.equal(tupleElement(Eight, 'Item8').index, 7);
  assert.equal(tupleElement(Eight, 'Item9'), null);
  assert.equal(Eight.toDisplayString(), '(int, int, int, int, int, int, int, int)');
  assert.equal(tupleElements(Sixteen).length, 16);
  const inner = Sixteen.typeArguments[7].type;
  assert.equal(isWideTuple(inner), true);
  assert.equal(inner.typeArguments[7].type.originalDefinition.metadataFullName, 'System.ValueTuple`2');
  assert.equal(tupleElement(Sixteen, 'Item16').symbol.type.specialType, 'System_Int32');
});

test('SF-A02-T08.4 TupleElementNames: the names of a symbol type are listed as .NET 10 emits them', () => {
  // Expected lists: the TransformNames of the attribute Roslyn 5.3 emits for fields of these types (read by reflection).
  const analysis = analysisOf(`using System.Collections.Generic;
class C {
  public (int a, int b, int c, int d, int e, int f, int g, int h, int i) Nine;
  public (int, int, int, int, int, int, int, int x) EightLastNamed;
  public (int a, (int b, int c) d)[] Nested;
  public Dictionary<(int a, int b), (int, string s)> Map;
  public (int, int) None;
  public (int a, int, int, int, int, int, int, int, int, int, int, int, int, int, int, int p) Sixteen;
  public int Plain;
}`);
  const types = fieldTypes(analysis, 'C'),
    nulls = count => Array(count).fill(null);
  assert.deepEqual(tupleElementNamesOf(types.Nine), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', null, null]);
  assert.deepEqual(tupleElementNamesOf(types.EightLastNamed), [...nulls(7), 'x', null]);
  assert.deepEqual(tupleElementNamesOf(types.Nested), ['a', 'd', 'b', 'c']);
  assert.deepEqual(tupleElementNamesOf(types.Map), ['a', 'b', null, 's']);
  assert.equal(tupleElementNamesOf(types.None), null);
  assert.deepEqual(tupleElementNamesOf(types.Sixteen), ['a', ...nulls(14), 'p', ...nulls(9), ...nulls(2)]);
  assert.equal(tupleElementNamesOf(types.Plain), null);
});

test('SF-A02-T08.4 TupleElementNames round trip: the listed names applied to the unnamed type give the named type back', () => {
  const named = `public (int a, int b, int c, int d, int e, int f, int g, int h, int i) Nine;
  public (int, int, int, int, int, int, int, int x) Eight;
  public (int a, (int b, int c) d)[] Nested;
  public (int a, int, int, int, int, int, int, int, int, int, int, int, int, int, int, int p) Sixteen;`;
  const analysis = analysisOf(`class Named { ${named} }\nclass Plain { ${named.replace(/(int|\)) [a-z]\b/g, '$1')} }`);
  const withNames = fieldTypes(analysis, 'Named'),
    plain = fieldTypes(analysis, 'Plain');
  for (const field of Object.keys(withNames)) {
    assert.equal(tupleElementNamesOf(plain[field]), null, field);
    assert.notEqual(plain[field].toDisplayString(), withNames[field].toDisplayString(), field);
    const restored = applyTupleElementNames(plain[field], tupleElementNamesOf(withNames[field])).type;
    assert.equal(restored.toDisplayString(), withNames[field].toDisplayString(), field);
    assert.equal(restored.equals(withNames[field]), true, field);
  }
  // A list that does not fit the type leaves it unchanged.
  assert.equal(applyTupleElementNames(plain.Nine, ['a', 'b']).type.toDisplayString(), plain.Nine.toDisplayString());
});

test('SF-A02-T08.4 diagnostics: an element beyond the last, Rest of a short tuple, lengths that differ', () => {
  const codes = body => errorsOf(analysisOf(program(`var big = (1, 2, 3, 4, 5, 6, 7, 8, 9); var small = (1, 2);\n${body}`)));
  assert.deepEqual(codes('Console.WriteLine(big.Item10);'), ['CS1061']);
  assert.deepEqual(codes('Console.WriteLine(small.Rest);'), ['CS1061']);
  assert.deepEqual(codes('Console.WriteLine(big.Rest.Item3);'), ['CS1061']);
  assert.deepEqual(codes('Console.WriteLine(big == (1, 2, 3, 4, 5, 6, 7, 8));'), ['CS8384']);
  assert.deepEqual(codes('var (a, b) = big;'), ['CS8132']);
  assert.deepEqual(codes('(int, int, int, int, int, int, int, int, int Item8) t = big;'), ['CS8125']);
  assert.deepEqual(codes('(int, int, int, int, int, int, int, int, string) t = big;'), ['CS0029']);
  assert.deepEqual(codes('(double, int, int, int, int, int, int, int, double) t = big; Console.WriteLine(t.Item9);'), []);
});

test('SF-A02-T08.4 execution: wide tuples keep value semantics through elements and Rest on both back ends', () => {
  const lines = linesOf(
    program(`var t = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    var copy = t;
    t.Item10 = 100;
    t.Rest.Item1 = 80;
    var rest = t.Rest;
    rest.Item2 = -9;
    Console.WriteLine(t);
    Console.WriteLine(copy);
    Console.WriteLine(rest);
    Console.WriteLine(t == copy);
    var (a, _, _, _, _, _, _, h, _, j) = t;
    Console.WriteLine(a + h + j);`),
  );
  assert.deepEqual(lines, ['(1, 2, 3, 4, 5, 6, 7, 80, 9, 100)', '(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)', '(80, -9, 100)', 'False', '181']);
});

test('SF-A02-T08.4 unsupported: Equals and GetHashCode of a tuple are SF2200, as for short tuples', () => {
  const reported = notExecutable(program('var t = (1, 2, 3, 4, 5, 6, 7, 8, 9); Console.WriteLine(t.GetHashCode());'));
  assert.match(reported.message, /GetHashCode/);
});
